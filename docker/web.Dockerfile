FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
RUN pnpm config set store-dir /pnpm/store

WORKDIR /workspace
COPY . .

RUN pnpm install --frozen-lockfile

ARG PACKAGE_NAME
ARG PACKAGE_PATH
ENV TARGET_PACKAGE=$PACKAGE_NAME
ENV TARGET_PATH=$PACKAGE_PATH

RUN pnpm --filter "$TARGET_PACKAGE" build \
  && pnpm --filter "$TARGET_PACKAGE" deploy --prod /deploy \
  && cp -R "$TARGET_PATH/.next" /deploy/.next

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /deploy ./

USER node
CMD ["npm", "run", "start"]
