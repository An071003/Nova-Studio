# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/editor-core/package.json ./packages/editor-core/
COPY packages/editor-konva/package.json ./packages/editor-konva/
COPY apps/api/package.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter api exec prisma generate \
  && pnpm --filter @nova/shared build \
  && pnpm --filter api build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter api exec prisma migrate deploy && node apps/api/dist/main.js"]
