# Передача разработки на удалённый сервер

Актуальность: 29 июля 2026 года  
Канонический remote: `https://github.com/ker4ik13/seo-platform.git`  
Основная ветка: `main`

Этот файл — точка входа при переносе разработки. Нормативные требования
находятся в [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md),
а краткая живая карта реализации — в
[`PROJECT_MAP.md`](./PROJECT_MAP.md). При расхождении фактический код и
проверенный Git commit имеют приоритет для статуса реализации, но не отменяют
требования ТЗ.

## 1. Честный статус продукта

Проект **ещё не является готовым production SaaS**. Реализованы архитектурный
foundation и несколько сквозных вертикальных срезов закрытой alpha/private
beta. Нельзя включать публичные платежи, системные SEO-ключи или реальное
массовое снятие позиций без перечисленных ниже release gates.

Уже реализовано:

- единый Next.js Web с публичной веткой и закрытым от индексации `/app`;
- NestJS-контуры Platform API, SEO Data, Jobs/Integrations и Realtime;
- отдельные Prisma schemas/databases, миграции, Redis/BullMQ, NATS foundation,
  S3/email ports и Dokploy Compose;
- email/password identity, подтверждение email, recovery, sessions, CSRF,
  TOTP/recovery codes и terminal revoke session family;
- workspaces, projects, роли, приглашения и project access;
- resumable multipart upload, потоковая проверка ClamAV, CSV/TSV import,
  Key Collector mapping, staging, publish и чтение semantic core;
- encrypted BYOK vault, validation Keys.so/Arsenkin и project connector
  binding;
- tracking contexts, keyword assignments, provider-free rank estimate,
  immutable rank manifest, durable preparation/cancel recovery и normalized
  SEO Data ingest/finalize/current/history;
- public bounded rank-history API и private/noindex Web-экран с UTC,
  context/keyword filters, load-more и read-only состояниями;
- профильные/проектные настройки уведомлений, in-app центр и безопасный
  lifecycle browser push devices;
- базовые Web/Admin shells и responsive UI состояний реализованных срезов.

## 2. Что намеренно не готово

Критический следующий путь:

1. Завершить реальное снятие позиций: authoritative execution grant,
   lifecycle/billing precondition, scoped connector boundary без глобального
   чтения BYOK vault, подтверждённый контракт Arsenkin, provider submit/status
   и producer нормализованных результатов с сохранением ingest receipts.
   Public history API/UI уже готовы и не являются следующим runtime-шагом.
2. Добавить расписания, tenant fairness, per-provider/workspace rate limits,
   retries/partial results и проектные уведомления о результате.
3. Подключить transactional outbox publisher и durable JetStream consumers.
4. Реализовать фактическую email/Web Push/Telegram delivery, retry/DLQ,
   digest и delivery history.

Значимые незавершённые продуктовые области:

- OAuth Google/Яндекс и авторизация через Telegram;
- полноценная semantic grid: группы/кластеры/tags/custom columns, массовое
  редактирование, сохранённые views, export и version rollback;
- XLSX/ZIP import; legacy XLS требует отдельного изолированного worker;
- совместная таблица, presence/cursors/cell selections, comments и Yjs notes;
- Wordstat/frequency/SERP tools, конкуренты, pages/content map, audit;
- Radar, sitemap generator, Magnet;
- клиентские/гостевые/white-label отчёты;
- YooKassa, ledger/reservation/settlement, тарифы/лимиты, НПД «Мой налог» и
  выдача чека клиенту;
- системные provider keys и cost routing;
- Directus collections/seeds, production content, полноценный индексируемый
  Toolbox и публичный API всех инструментов;
- production admin workflows;
- observability stack, проверенные backups/restore, load/E2E/security gates.

Технические release blockers подробно перечислены в разделе
«Незавершённые риски» [`PROJECT_MAP.md`](./PROJECT_MAP.md) и в
[`docs/technical-spec/16-roadmap-and-acceptance.md`](./docs/technical-spec/16-roadmap-and-acceptance.md).
Особенно важны:

- Node.js 24 и PostgreSQL 18 staging proof вместо локальных проверок на более
  старых версиях;
- устранение глобального чтения BYOK vault execution-процессом;
- startup decrypt-canary и безопасная ротация keyrings;
- PostgreSQL concurrency/migration negative tests;
- RANGE partitioning/maintenance для `rank_snapshots` и representative
  history load test; наличие public history proxy/UI этот gate не закрывает;
- object storage lifecycle, quarantine cleanup и import staging retention;
- durable outbox/inbox и disaster recovery.

## 3. Порядок продолжения

Не распараллеливать следующие этапы до потери связности. Рекомендуемый порядок:

1. Поднять development/staging контур на VPS и зафиксировать baseline QA.
2. Закончить текущий runtime-срез
   `execution grant → scoped connector boundary → provider submit/status →
   normalized result producer/ingest receipts`.
3. Закрыть durable events и notification delivery.
4. Довести P1 semantic/collaboration gaps до используемой командной alpha.
5. Реализовать billing/YooKassa/НПД и только затем platform-paid providers.
6. Подключить Directus, публичный контент, Toolbox/API docs и SEO-инструменты.
7. Добавлять competitors/audits/reports/agency/AI по этапам P4–P7 из roadmap.

На каждом шаге:

- читать `AGENTS.md`, `PROJECT_MAP.md` и релевантный раздел ТЗ;
- не менять data ownership без ADR;
- contracts сначала изменять в `platform-contracts`;
- длинные/платные операции проводить через idempotent Job и
  estimate/reservation/settlement;
- после новых модулей, таблиц, очередей, событий или инфраструктуры обновлять
  `PROJECT_MAP.md`;
- выполнять service-level QA из `AGENTS.md`.

## 4. Первый запуск на VPS

Требования:

- Git, Docker/Compose и Dokploy;
- Node.js 24;
- Corepack и зафиксированный `pnpm`;
- отдельный development/staging набор secrets;
- внешний S3 и SMTP можно оставить выключенными до подключения.

Базовая проверка исходников:

```bash
git clone https://github.com/ker4ik13/seo-platform.git
cd seo-platform
corepack enable
corepack pnpm install --frozen-lockfile
DATABASE_URL=postgresql://local:local@127.0.0.1:5432/local corepack pnpm prisma:generate
DATABASE_URL=postgresql://local:local@127.0.0.1:5432/local corepack pnpm prisma:validate
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Для Dokploy:

1. Создать Compose project из корня репозитория.
2. Перенести значения из `.env.example` в secret/environment UI Dokploy.
3. Заменить каждый placeholder и сгенерировать все отдельные service tokens и
   keyrings; не хранить реальный `.env` в Git. Compose fail-closed требует
   отдельные `JOBS_TO_SEO_RANK_RESULT_TOKEN` и `RANK_HISTORY_CURSOR_KEY`; в
   текущей topology оба значения получает только `seo-data`, а не Jobs/Web/API workers.
4. На первом запуске оставить `S3_ENABLED=false`, `EMAIL_ENABLED=false`,
   `WEB_PUSH_REGISTRATION_ENABLED=false`,
   `DIRECTUS_STORAGE_DRIVER=local`.
5. Привязать временные development domains к Web/API/Realtime/Directus.
   Не публиковать незавершённый Admin: он остаётся internal-only до operator
   auth/2FA/authorization/audit и замены demo data.
6. Выполнить migrations как отдельные one-shot release steps, затем поднять
   applications/workers.
7. Проверить health/readiness, логи без секретов и только после этого
   проходить protected browser smoke.

Подробности и ограничения находятся в
[`platform-infrastructure/README.md`](./platform-infrastructure/README.md).

## 5. Минимальная проверка после переноса

- регистрация → подтверждение → вход → refresh/logout;
- workspace/project/team permission boundaries;
- CSV/TSV upload → inspection → mapping → publish → keyword list;
- BYOK credential create → validation → project binding;
- tracking context → assignment → estimate → manual Job lifecycle;
- bounded rank history API/UI: UTC range, context/keyword filters, load-more,
  archived project и billing read-only;
- notification preferences/device lifecycle без заявления о реальной
  доставке;
- `/app` возвращает `noindex` и отсутствует в sitemap;
- tenant-crossing, archive/read-only и offline/retry состояния;
- fresh migrations и негативные constraint tests на PostgreSQL 18;
- restart Redis/workers во время Job для проверки DB recovery;
- backup → restore в отдельное окружение.

## 6. Инструкция следующему Codex-сеансу

Начинать работу с такого контекста:

> Продолжай разработку SEO Platform из текущего `main`. Полностью прочитай
> `AGENTS.md`, затем `HANDOFF.md`, `PROJECT_MAP.md`,
> `docs/technical-spec/00-index.md` и релевантные разделы ТЗ. Сначала проверь
> фактический Git status и QA на Node.js 24/PostgreSQL 18. Не объявляй
> provider execution, delivery или billing готовыми без работающего
> end-to-end сценария. Следующий приоритет — раздел 3 `HANDOFF.md`. Все новые
> границы и остаточные риски записывай в `PROJECT_MAP.md`, делай небольшие
> связные коммиты.

## 7. Git и восстановление истории

Решение о едином репозитории описано в
[`ADR-2026-037`](./docs/adr/ADR-2026-037-single-github-monorepo.md).
Истории прежних `platform-*` репозиториев импортируются без squash, поэтому
они остаются доступны в общем Git graph. Runtime/deployment boundaries при
этом не объединяются.
