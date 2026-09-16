FROM node:24-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @campus-gaming-network/admin

FROM deps AS dev
COPY apps/admin ./apps/admin
WORKDIR /app/apps/admin
EXPOSE 3002
CMD ["npm", "run", "dev", "--", "--port", "3002"]

FROM deps AS build
COPY apps/admin ./apps/admin
RUN npm --prefix apps/admin run build

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
