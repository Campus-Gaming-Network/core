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
RUN pnpm --filter @campus-gaming-network/admin run build \
    && mkdir -p /dist/src/server \
    && cp -R apps/admin/.output /dist/.output \
    && cp apps/admin/src/production-preflight.ts /dist/src/ \
    && cp apps/admin/src/server/environment.server.ts /dist/src/server/

FROM base AS runner
ENV NODE_ENV=production \
    DEPLOYMENT_ENV=production \
    HOST=0.0.0.0 \
    PORT=3002
# The build stage gathers what runs into /dist, so this is one copy and one
# layer: each layer costs time to export and push.
COPY --from=build --chown=node:node /dist ./apps/admin
WORKDIR /app/apps/admin
USER node
EXPOSE 3002
CMD ["node", "src/production-preflight.ts"]
