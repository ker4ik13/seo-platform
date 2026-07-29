# SEO Platform

Единый source monorepo независимо разворачиваемых сервисов международной
SEO-платформы. Публичный сайт, Toolbox, API docs и приложение `/app` находятся
в `platform-web`.

Проект ещё находится в разработке. Перед переносом, развёртыванием или
продолжением работы прочитайте [`HANDOFF.md`](./HANDOFF.md): там зафиксированы
реальная степень готовности, незавершённые функции, release blockers и порядок
запуска на VPS.

## С чего начать

1. Прочитать [`PROJECT_MAP.md`](./PROJECT_MAP.md).
2. Открыть [`HANDOFF.md`](./HANDOFF.md).
3. Открыть [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).
4. Скопировать `.env.example` в `.env` на remote development VPS.
5. Использовать Node.js 24 и включить Corepack.
6. Установить зависимости: `corepack pnpm install --frozen-lockfile`.
7. Сгенерировать Prisma clients: `pnpm prisma:generate`.
8. Запустить remote stack из `platform-infrastructure`.

Локально не требуется держать все сервисы одновременно. Каждый пакет имеет
собственные `dev`, `typecheck`, `test` и `build` scripts, а runtime/data
boundaries остаются независимыми несмотря на общий Git-репозиторий.

## Команды workspace

- `pnpm typecheck` — TypeScript во всех пакетах;
- `pnpm test` — тесты во всех пакетах;
- `pnpm build` — production build;
- `pnpm prisma:generate` — генерация Prisma clients;
- `pnpm prisma:validate` — проверка Prisma schemas;
- `pnpm infra:validate` — синтаксическая проверка Dokploy Compose.

Production deployment и remote-development topology описаны в
[`platform-infrastructure/README.md`](./platform-infrastructure/README.md).
