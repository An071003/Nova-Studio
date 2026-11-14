import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import type { INestApplication } from '@nestjs/common';

describe('Health & Seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 with db, redis, s3 up', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: {
        db: 'up',
        redis: 'up',
        s3: 'up',
      },
    });
  });

  it('seed creates 3 users, 1 workspace, and 1 sample project', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: ['owner@nova.dev', 'editor@nova.dev', 'viewer@nova.dev'] } },
    });
    expect(users).toHaveLength(3);

    const workspace = await prisma.workspace.findUnique({ where: { slug: 'nova-demo' } });
    expect(workspace).not.toBeNull();

    const project = await prisma.project.findFirst({
      where: { workspaceId: workspace?.id, deletedAt: null },
      include: { document: true },
    });
    expect(project).not.toBeNull();
    expect(project?.document).not.toBeNull();
  });
});
