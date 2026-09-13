ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

USER root
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web-start/package.json ./apps/web-start/package.json
RUN npm ci --workspace @campus-gaming-network/docs

COPY docs ./docs
COPY apps/docs ./apps/docs

WORKDIR /app/apps/docs

EXPOSE 3001

CMD ["npm", "run", "start:docker"]
