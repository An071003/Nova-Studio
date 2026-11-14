import path from 'node:path';
import dotenv from 'dotenv';
import argon2 from 'argon2';
import { PrismaClient, Role } from '@prisma/client';
import * as Y from 'yjs';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

function createInitialDocBytes(title: string): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    meta.set('createdAt', Date.now());
    meta.set('title', title);

    const pages = doc.getMap<Y.Map<unknown>>('pages');
    const mainPage = new Y.Map<unknown>();
    mainPage.set('id', 'page:main');
    mainPage.set('name', 'Page 1');
    mainPage.set('index', 'a0');
    mainPage.set('background', '#1A1A1E');
    pages.set('page:main', mainPage);
  });
  return Y.encodeStateAsUpdate(doc);
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('Passw0rd!', { type: argon2.argon2id });

  const seedUsers: Array<{ email: string; name: string; role: Role }> = [
    { email: 'owner@nova.dev', name: 'Nova Owner', role: Role.OWNER },
    { email: 'editor@nova.dev', name: 'Nova Editor', role: Role.EDITOR },
    { email: 'viewer@nova.dev', name: 'Nova Viewer', role: Role.VIEWER },
  ];

  const users = new Map<string, string>();
  for (const item of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: { name: item.name, passwordHash },
      create: { email: item.email, name: item.name, passwordHash },
    });
    users.set(item.email, user.id);
  }

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'nova-demo' },
    update: { name: 'Nova Demo Studio' },
    create: { name: 'Nova Demo Studio', slug: 'nova-demo' },
  });

  for (const item of seedUsers) {
    const userId = users.get(item.email);
    if (!userId) continue;
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: { role: item.role },
      create: { workspaceId: workspace.id, userId, role: item.role },
    });
  }

  const ownerId = users.get('owner@nova.dev') ?? '';
  const existingProject = await prisma.project.findFirst({
    where: { workspaceId: workspace.id, deletedAt: null },
  });

  if (!existingProject) {
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: 'Welcome Canvas',
        createdById: ownerId,
      },
    });
    await prisma.projectDocument.create({
      data: {
        projectId: project.id,
        state: Buffer.from(createInitialDocBytes('Welcome Canvas')),
        schemaVersion: 1,
      },
    });
  }
}

main()
  .catch((err) => {
    process.stderr.write(`Seed failed: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
