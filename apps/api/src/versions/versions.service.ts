import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  DOC_SCHEMA_VERSION,
  ERROR_CODES,
  NovaError,
  type CreateVersionDto,
  type RestoreVersionBodyDto,
  type RestoreVersionResponse,
  type VersionPreview,
  type VersionSummary,
} from '@nova/shared';
import type { ProjectVersion } from '@prisma/client';
import { Redis } from 'ioredis';
import * as Y from 'yjs';
import { getApiEnv } from '../common/env';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';

const RESTORE_CHANNEL_PREFIX = 'nova:restore:';

function toVersionSummary(v: ProjectVersion): VersionSummary {
  return {
    id: v.id,
    projectId: v.projectId,
    label: v.label,
    createdById: v.createdById,
    createdAt: v.createdAt.toISOString(),
    isAuto: v.isAuto,
  };
}

function decodeAndValidateYjsBase64(stateBase64: string): Uint8Array<ArrayBuffer> {
  const cleaned = stateBase64.trim();
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.byteLength === 0) {
    throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Invalid Yjs state snapshot');
  }
  const bytes = Uint8Array.from(buf);
  const probeDoc = new Y.Doc();
  try {
    Y.applyUpdate(probeDoc, bytes);
    return bytes;
  } catch {
    throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Corrupt Yjs state snapshot');
  } finally {
    probeDoc.destroy();
  }
}

@Injectable()
export class VersionsService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {
    this.redis = new Redis(getApiEnv().redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.redis.on('error', () => {
      // Avoid unhandled error events during tests or transient Redis disconnects
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async publishRestoreSnapshot(projectId: string, state: Uint8Array): Promise<void> {
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      const payload = Buffer.from(state).toString('base64');
      await this.redis.publish(`${RESTORE_CHANNEL_PREFIX}${projectId}`, payload);
    } catch {
      // Best-effort notification; ProjectDocument in Postgres holds the restored snapshot
    }
  }

  async listVersions(
    userId: string,
    projectId: string,
  ): Promise<{ versions: VersionSummary[] }> {
    await this.permissions.assertProject(userId, projectId, 'version.view');

    const rows = await this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });

    return { versions: rows.map(toVersionSummary) };
  }

  async createVersion(
    userId: string,
    projectId: string,
    dto: CreateVersionDto,
  ): Promise<{ version: VersionSummary }> {
    const { project } = await this.permissions.assertProject(
      userId,
      projectId,
      'version.create',
    );

    const suppliedBytes = dto.stateBase64 ? decodeAndValidateYjsBase64(dto.stateBase64) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      let stateBytes: Uint8Array<ArrayBuffer>;
      if (suppliedBytes) {
        stateBytes = suppliedBytes;
        await tx.projectDocument.upsert({
          where: { projectId },
          create: {
            projectId,
            state: stateBytes,
            schemaVersion: DOC_SCHEMA_VERSION,
          },
          update: {
            state: stateBytes,
          },
        });
      } else {
        const docRow = await tx.projectDocument.findUnique({ where: { projectId } });
        if (!docRow) {
          throw new NovaError(ERROR_CODES.NOT_FOUND, 'Project document not found');
        }
        stateBytes = Uint8Array.from(docRow.state);
      }

      const version = await tx.projectVersion.create({
        data: {
          projectId,
          label: dto.label,
          state: stateBytes,
          createdById: userId,
          isAuto: false,
        },
      });

      await tx.auditLog.create({
        data: {
          workspaceId: project.workspaceId,
          actorId: userId,
          action: 'version.created',
          targetType: 'project_version',
          targetId: version.id,
          meta: {
            projectId,
            label: version.label,
            isAuto: false,
          },
        },
      });

      return version;
    });

    return { version: toVersionSummary(created) };
  }

  async getVersionPreview(
    userId: string,
    projectId: string,
    versionId: string,
  ): Promise<VersionPreview> {
    await this.permissions.assertProject(userId, projectId, 'version.view');

    const version = await this.prisma.projectVersion.findFirst({
      where: { id: versionId, projectId },
    });
    if (!version) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Version not found');
    }

    return {
      id: version.id,
      label: version.label,
      stateBase64: Buffer.from(version.state).toString('base64'),
      createdAt: version.createdAt.toISOString(),
    };
  }

  async restoreVersion(
    userId: string,
    projectId: string,
    versionId: string,
    body: RestoreVersionBodyDto = {},
  ): Promise<RestoreVersionResponse> {
    const { project } = await this.permissions.assertProject(
      userId,
      projectId,
      'version.restore',
    );

    const targetVersion = await this.prisma.projectVersion.findFirst({
      where: { id: versionId, projectId },
    });
    if (!targetVersion) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Version not found');
    }

    const suppliedCurrent = body.currentStateBase64
      ? decodeAndValidateYjsBase64(body.currentStateBase64)
      : null;

    const targetBytes = Uint8Array.from(targetVersion.state);

    const backupVersion = await this.prisma.$transaction(async (tx) => {
      const existingDoc = await tx.projectDocument.findUnique({ where: { projectId } });
      const backupBytes =
        suppliedCurrent ?? (existingDoc ? Uint8Array.from(existingDoc.state) : targetBytes);

      const backup = await tx.projectVersion.create({
        data: {
          projectId,
          label: 'Before restore',
          state: backupBytes,
          createdById: userId,
          isAuto: true,
        },
      });

      await tx.projectDocument.upsert({
        where: { projectId },
        create: {
          projectId,
          state: targetBytes,
          schemaVersion: DOC_SCHEMA_VERSION,
        },
        update: {
          state: targetBytes,
        },
      });

      await tx.auditLog.create({
        data: {
          workspaceId: project.workspaceId,
          actorId: userId,
          action: 'version.restored',
          targetType: 'project_version',
          targetId: targetVersion.id,
          meta: {
            projectId,
            versionId: targetVersion.id,
            label: targetVersion.label,
            backupVersionId: backup.id,
          },
        },
      });

      return backup;
    });

    await this.publishRestoreSnapshot(projectId, targetBytes);

    return {
      version: toVersionSummary(targetVersion),
      backupVersion: toVersionSummary(backupVersion),
    };
  }
}
