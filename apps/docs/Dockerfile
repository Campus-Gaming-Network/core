ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

USER root
WORKDIR /app
ENV NODE_ENV=development
RUN npm install --global pnpm@12.6.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --filter @campus-gaming-network/docs --filter campus-gaming-network-core --frozen-lockfile

COPY docs ./docs
COPY apps/docs ./apps/docs

WORKDIR /app/apps/docs

EXPOSE 3001

CMD ["pnpm", "run", "start:docker"]
