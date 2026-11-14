# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_REALTIME_URL=ws://localhost/ws
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
ENV NEXT_TELEMETRY_DISABLED=1

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
COPY packages/ui ./packages/ui
COPY packages/editor-core ./packages/editor-core
COPY packages/editor-konva ./packages/editor-konva
COPY apps/web ./apps/web

RUN pnpm --filter @nova/shared build \
  && pnpm --filter @nova/ui build \
  && pnpm --filter @nova/editor-core build \
  && pnpm --filter @nova/editor-konva build \
  && pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/ui/package.json ./packages/ui/
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=builder /app/packages/editor-core/package.json ./packages/editor-core/
COPY --from=builder /app/packages/editor-core/dist ./packages/editor-core/dist
COPY --from=builder /app/packages/editor-core/node_modules ./packages/editor-core/node_modules
COPY --from=builder /app/packages/editor-konva/package.json ./packages/editor-konva/
COPY --from=builder /app/packages/editor-konva/dist ./packages/editor-konva/dist
COPY --from=builder /app/packages/editor-konva/node_modules ./packages/editor-konva/node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules

EXPOSE 3000
CMD ["pnpm", "--filter", "web", "exec", "next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
