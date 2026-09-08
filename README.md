# SEOньорита / SEOnorita

Монорепозиторий SEO-платформы с тремя прикладными сервисами:

- `frontend` — единый Next.js для сайта, `/app` и `/admin`;
- `backend-core` — API, SEO domain и Realtime;
- `backend-execution` — jobs, очереди и внешние SEO-провайдеры.

Общие packages находятся в `packages`, deployment и data services — в
`infrastructure`. Актуальная структура и границы владения описаны в
[`PROJECT_MAP.md`](./PROJECT_MAP.md).

## Локальная подготовка

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm build
```

Требуются Node.js 24+ и pnpm 11. Production secrets не хранятся в Git.

## Проверка

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Развёртывание

- Dokploy: [`infrastructure/DOKPLOY.md`](./infrastructure/DOKPLOY.md);
- production secrets, S3 и backup:
  [`infrastructure/DOKPLOY-SECRETS.md`](./infrastructure/DOKPLOY-SECRETS.md);
- устройство инфраструктуры: [`infrastructure/README.md`](./infrastructure/README.md);
- single-node production-like runtime: [`infrastructure/vps/README.md`](./infrastructure/vps/README.md);
- техническое ТЗ: [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).

Решение о трёх deployables и удалении неиспользуемого Directus зафиксировано
в [`ADR-2026-041`](./docs/adr/ADR-2026-041-three-application-services.md).

## Работа с проектом и готовность MVP

- [Практическая инструкция](docs/WORKING_GUIDE.md): разработка, локальный Caddy,
  сквозные тесты и ежедневная очистка.
- [Checklist платного MVP](docs/MVP_LAUNCH_CHECKLIST.md): порядок запуска и
  проверяемые критерии готовности.
- [Аудит 6 сентября 2026](docs/mvp-audit-2026-09-06.md): исправления, фактические
  проверки и оставшиеся ограничения.

[Приёмка production MVP — 7 сентября 2026](docs/mvp-production-audit-2026-09-07.md) — результаты проверок, живой бюджет запросов и оставшиеся внешние условия запуска.
