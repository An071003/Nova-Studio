# 02 — DATABASE (PostgreSQL + Prisma)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { OWNER EDITOR VIEWER }
enum AssetStatus { PENDING READY FAILED }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String
  passwordHash  String
  avatarUrl     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  memberships   WorkspaceMember[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  familyId   String
  tokenHash  String    @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([familyId])
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   WorkspaceMember[]
  projects  Project[]
  invites   Invite[]
}

model WorkspaceMember {
  workspaceId String
  userId      String
  role        Role
  joinedAt    DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([workspaceId, userId])
}

model Invite {
  id          String    @id @default(cuid())
  workspaceId String
  email       String?
  role        Role
  tokenHash   String    @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdById String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

model Project {
  id           String    @id @default(cuid())
  workspaceId  String
  name         String
  thumbnailKey String?
  createdById  String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  document     ProjectDocument?
  versions     ProjectVersion[]
  assets       Asset[]
  members      ProjectMember[]
  @@index([workspaceId, deletedAt])
}

/// Override quyền theo project (nếu không có → dùng role workspace)
model ProjectMember {
  projectId String
  userId    String
  role      Role
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@id([projectId, userId])
}

/// Trạng thái Yjs hiện tại (Y.encodeStateAsUpdate)
model ProjectDocument {
  projectId     String   @id
  state         Bytes
  schemaVersion Int      @default(1)
  updatedAt     DateTime @updatedAt
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model ProjectVersion {
  id          String   @id @default(cuid())
  projectId   String
  label       String
  state       Bytes
  createdById String
  createdAt   DateTime @default(now())
  isAuto      Boolean  @default(false)
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, createdAt])
}

model Asset {
  id          String      @id @default(cuid())
  projectId   String
  key         String      @unique
  mimeType    String
  sizeBytes   Int
  width       Int?
  height      Int?
  status      AssetStatus @default(PENDING)
  uploadedById String
  createdAt   DateTime    @default(now())
  project     Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId])
}

model AuditLog {
  id          String   @id @default(cuid())
  workspaceId String
  actorId     String
  action      String
  targetType  String
  targetId    String
  meta        Json?
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
}
```

## Quy tắc
- Migration bằng `prisma migrate dev --name <snake_case>`; không sửa migration đã merge.
- Soft delete project (`deletedAt`), purge sau 30 ngày (worker cron).
- Auto version: worker tạo `isAuto=true` mỗi 30 phút nếu doc thay đổi; giữ 50 bản auto gần nhất.
- Seed (`pnpm db:seed`): 3 user (owner@nova.dev, editor@nova.dev, viewer@nova.dev / `Passw0rd!`), 1 workspace, 1 project mẫu.
