FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
RUN pnpm config set store-dir /pnpm/store

WORKDIR /workspace
COPY . .

RUN pnpm install --frozen-lockfile

ARG PACKAGE_NAME
ENV TARGET_PACKAGE=$PACKAGE_NAME

RUN pnpm --filter @seo-platform/contracts build \
  && pnpm --filter "$TARGET_PACKAGE" prisma:generate \
  && pnpm --filter "$TARGET_PACKAGE" build \
  && pnpm --filter "$TARGET_PACKAGE" deploy --prod /deploy

FROM build AS migration
CMD ["sh", "-c", "pnpm --filter \"$TARGET_PACKAGE\" prisma:migrate:deploy"]

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /deploy ./

USER node
CMD ["node", "dist/main.js"]

FROM runtime AS nats-provisioner

COPY --chown=node:node infrastructure/nats/topology.mjs /app/nats/topology.mjs
COPY --chown=node:node infrastructure/nats/provisioner-config.mjs /app/nats/provisioner-config.mjs
COPY --chown=node:node infrastructure/nats/provisioner.mjs /app/nats/provisioner.mjs

CMD ["node", "/app/nats/provisioner.mjs"]
