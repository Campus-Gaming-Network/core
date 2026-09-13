FROM node:24-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @campus-gaming-network/web

FROM deps AS dev
COPY apps/web ./apps/web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--port", "3000"]

FROM deps AS build
COPY apps/web ./apps/web
RUN npm --prefix apps/web run build

FROM base AS runner
ENV NODE_ENV=production \
    DEPLOYMENT_ENV=production \
    HOST=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.output ./apps/web/.output
COPY --from=build --chown=node:node /app/apps/web/src/production-preflight.ts ./apps/web/src/production-preflight.ts
COPY --from=build --chown=node:node /app/apps/web/src/server/environment.server.ts ./apps/web/src/server/environment.server.ts
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "src/production-preflight.ts"]
