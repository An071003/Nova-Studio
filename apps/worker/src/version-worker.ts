import { AUTO_VERSION_QUEUE } from '@nova/shared';
import type { PrismaClient } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

export const DEFAULT_MAX_AUTO_VERSIONS = 50;
export const DEFAULT_AUTO_VERSION_INTERVAL_MS = 30 * 60_000;

export interface AutoVersionCandidateProject {
  id: string;
  createdById: string;
  document: {
    state: Uint8Array;
    updatedAt: Date;
  } | null;
}

export interface AutoVersionLatestSnapshot {
  id: string;
  state: Uint8Array;
  createdAt: Date;
}

export interface AutoVersionStore {
  findActiveProjectsWithDocuments: () => Promise<AutoVersionCandidateProject[]>;
  findLatestVersion: (projectId: string) => Promise<AutoVersionLatestSnapshot | null>;
  createAutoVersion: (input: {
    projectId: string;
    label: string;
    state: Uint8Array<ArrayBuffer>;
    createdById: string;
  }) => Promise<{ id: string }>;
  pruneAutoVersions: (projectId: string, keepCount: number) => Promise<number>;
}

export function createPrismaAutoVersionStore(prisma: PrismaClient): AutoVersionStore {
  return {
    findActiveProjectsWithDocuments: async () =>
      prisma.project.findMany({
        where: { deletedAt: null, document: { isNot: null } },
        select: {
          id: true,
          createdById: true,
          document: {
            select: {
              state: true,
              updatedAt: true,
            },
          },
        },
      }),
    findLatestVersion: async (projectId: string) =>
      prisma.projectVersion.findFirst({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          state: true,
          createdAt: true,
        },
      }),
    createAutoVersion: async (input) =>
      prisma.projectVersion.create({
        data: {
          projectId: input.projectId,
          label: input.label,
          state: input.state,
          createdById: input.createdById,
          isAuto: true,
        },
        select: { id: true },
      }),
    pruneAutoVersions: async (projectId: string, keepCount: number) => {
      const stale = await prisma.projectVersion.findMany({
        where: { projectId, isAuto: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: keepCount,
        select: { id: true },
      });
      if (stale.length === 0) {
        return 0;
      }
      const deleted = await prisma.projectVersion.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
      return deleted.count;
    },
  };
}

export interface AutoVersionSweepResult {
  checkedProjects: number;
  createdCount: number;
  prunedCount: number;
}

function statesDiffer(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
}

export async function runAutoVersionSweep(
  store: AutoVersionStore,
  options: { maxAutoVersions?: number } = {},
): Promise<AutoVersionSweepResult> {
  const maxAutoVersions = Math.max(1, options.maxAutoVersions ?? DEFAULT_MAX_AUTO_VERSIONS);
  const projects = await store.findActiveProjectsWithDocuments();

  let createdCount = 0;
  let prunedCount = 0;

  for (const project of projects) {
    if (!project.document) continue;

    const latest = await store.findLatestVersion(project.id);
    const hasDocChanged =
      !latest ||
      (project.document.updatedAt.getTime() > latest.createdAt.getTime() &&
        statesDiffer(project.document.state, latest.state));

    if (!hasDocChanged) continue;

    await store.createAutoVersion({
      projectId: project.id,
      label: 'Auto snapshot',
      state: Uint8Array.from(project.document.state),
      createdById: project.createdById,
    });
    createdCount += 1;
    prunedCount += await store.pruneAutoVersions(project.id, maxAutoVersions);
  }

  return {
    checkedProjects: projects.length,
    createdCount,
    prunedCount,
  };
}

export interface AutoVersionWorkerOptions {
  redisUrl: string;
  prisma: PrismaClient;
  maxAutoVersions?: number;
}

export function createAutoVersionWorker(options: AutoVersionWorkerOptions): {
  worker: Worker<Record<string, never>, AutoVersionSweepResult>;
  schedule: (intervalMs?: number) => Promise<void>;
  close: () => Promise<void>;
} {
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const store = createPrismaAutoVersionStore(options.prisma);

  const queue = new Queue<Record<string, never>, AutoVersionSweepResult>(AUTO_VERSION_QUEUE, {
    connection: connection.duplicate(),
  });

  const worker = new Worker<Record<string, never>, AutoVersionSweepResult>(
    AUTO_VERSION_QUEUE,
    async (_job: Job<Record<string, never>>) =>
      runAutoVersionSweep(store, { maxAutoVersions: options.maxAutoVersions }),
    {
      connection,
      concurrency: 1,
    },
  );

  return {
    worker,
    schedule: async (intervalMs = DEFAULT_AUTO_VERSION_INTERVAL_MS) => {
      await queue.upsertJobScheduler(
        'nova-auto-version-sweep',
        { every: intervalMs },
        { name: 'sweep', data: {} },
      );
    },
    close: async () => {
      await worker.close();
      await queue.close();
      await connection.quit();
    },
  };
}
