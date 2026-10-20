FROM node:24-alpine AS base

WORKDIR /app
RUN npm install --global pnpm@12.6.0

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --filter @campus-gaming-network/admin --frozen-lockfile

FROM deps AS dev
COPY apps/admin ./apps/admin
WORKDIR /app/apps/admin
EXPOSE 3002
CMD ["pnpm", "run", "dev", "--", "--port", "3002"]

FROM deps AS build
COPY apps/admin ./apps/admin
RUN pnpm --filter @campus-gaming-network/admin run build

FROM base AS runner
ENV NODE_ENV=production \
    DEPLOYMENT_ENV=production \
    HOST=0.0.0.0 \
    PORT=3002
COPY --from=build --chown=node:node /app/apps/admin/.output ./apps/admin/.output
COPY --from=build --chown=node:node /app/apps/admin/src/production-preflight.ts ./apps/admin/src/production-preflight.ts
COPY --from=build --chown=node:node /app/apps/admin/src/server/environment.server.ts ./apps/admin/src/server/environment.server.ts
WORKDIR /app/apps/admin
USER node
EXPOSE 3002
CMD ["node", "src/production-preflight.ts"]
