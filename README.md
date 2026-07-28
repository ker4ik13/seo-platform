# SEO Platform development workspace

Координационный workspace для независимо разворачиваемых сервисов
международной SEO-платформы. Публичный сайт, Toolbox, API docs и приложение
`/app` находятся в едином `platform-web`.

## С чего начать

1. Прочитать [`PROJECT_MAP.md`](./PROJECT_MAP.md).
2. Открыть [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).
3. Скопировать `.env.example` в `.env` на remote development VPS.
4. Использовать Node.js 24 и включить Corepack.
5. Установить зависимости: `corepack pnpm install`.
6. Сгенерировать Prisma clients: `pnpm prisma:generate`.
7. Запустить remote stack из `platform-infrastructure`.

Локально не требуется держать все сервисы одновременно. Каждый пакет имеет собственные `dev`, `typecheck`, `test` и `build` scripts.

## Команды workspace

- `pnpm typecheck` — TypeScript во всех пакетах;
- `pnpm test` — тесты во всех пакетах;
- `pnpm build` — production build;
- `pnpm prisma:generate` — генерация Prisma clients;
- `pnpm prisma:validate` — проверка Prisma schemas;
- `pnpm infra:validate` — синтаксическая проверка Dokploy Compose.

Production deployment и remote-development topology описаны в
[`platform-infrastructure/README.md`](./platform-infrastructure/README.md).
