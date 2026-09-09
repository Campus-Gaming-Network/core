FROM node:24-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web-start/package.json ./apps/web-start/package.json
RUN npm ci --workspace @campus-gaming-network/web-start

FROM deps AS dev
COPY apps/web-start ./apps/web-start
WORKDIR /app/apps/web-start
EXPOSE 3100
CMD ["npm", "run", "dev", "--", "--port", "3100"]

FROM deps AS build
COPY apps/web-start ./apps/web-start
RUN npm --prefix apps/web-start run build

FROM base AS runner
ENV NODE_ENV=production \
    DEPLOYMENT_ENV=production \
    HOST=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web-start/.output ./apps/web-start/.output
COPY --from=build --chown=node:node /app/apps/web-start/src/production-preflight.ts ./apps/web-start/src/production-preflight.ts
COPY --from=build --chown=node:node /app/apps/web-start/src/server/environment.server.ts ./apps/web-start/src/server/environment.server.ts
WORKDIR /app/apps/web-start
USER node
EXPOSE 3000
CMD ["node", "src/production-preflight.ts"]
