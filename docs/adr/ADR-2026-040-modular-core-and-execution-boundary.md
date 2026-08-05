# ADR-2026-040: модульный Core и изолированный Execution

- Статус: принято
- Дата: 4 августа 2026 года
- Затронутые области: `platform-api`, `platform-seo-data`,
  `platform-realtime`, `platform-jobs-integrations`, PostgreSQL, Redis, NATS,
  Dokploy/VPS runtime
- Изменение API/БД: консолидация четырёх application backends в два
  логических компонента и двух application databases с поэтапным совместимым
  cutover

Развёртывание process profiles и итоговые имена каталогов уточнены
ADR-2026-041: frontend, backend-core и backend-execution являются тремя
application deployables.

## Контекст

Четыре исходных backend-сервиса физически разделяют Platform API, SEO Data,
Realtime и Jobs/Integrations. Такое разделение даёт независимое владение
данными, но в текущей monorepo/small-team модели создаёт несоразмерную цену:
внутренние HTTP clients, повторная tenant/context validation, отдельные
service tokens, четыре Prisma schemas/migration pipelines и eventual
consistency там, где операция является одним бизнес-действием.

Долгие, внешние и платные операции по-прежнему требуют независимого process
lifecycle, bounded concurrency и отдельной credential capability. Количество
worker-процессов нельзя отождествлять с количеством микросервисов: разные
process profiles могут собираться из одного компонента и масштабироваться
независимо.

Runtime также содержит PostgreSQL-specific SQL. Обычный CRUD не должен
дублировать Prisma Client, но row/advisory locks, `SKIP LOCKED`, triggers,
partial/expression indexes и `SECURITY DEFINER` brokers являются частью
correctness/security model и не имеют безопасной механической замены на ORM.

## Решение

Целевая backend-архитектура содержит два логических компонента.

### `platform-core`

Core владеет identity, workspace/project/RBAC, billing, audit, semantics,
pages, rank history/results, crawl snapshots, notifications и realtime
control plane. Его authoritative данные размещаются в одной `app_db`, но
разделены PostgreSQL schemas `core`, `seo` и `realtime` и Nest domain modules.
Prisma использует multi-schema mapping; междоменные связи внутри Core могут
получать настоящие foreign keys и общие транзакции.

Public HTTP API остаётся единственной browser boundary. SEO Data больше не
является внутренним HTTP-микросервисом. Realtime gateway остаётся отдельным
масштабируемым process profile из Core artifact из-за long-lived sockets и
Redis adapter, но не является отдельным data-ownership component.

### `platform-execution`

Execution владеет Jobs, schedules, uploads/import staging, provider routing,
credential vault и execution receipts. Его `execution_db` и durable BullMQ
остаются отдельной failure/security boundary. Rank, connector, crawl, import,
inspection, system и auth-email остаются отдельными process profiles одного
artifact.

Connector profile сохраняет отдельный PostgreSQL login без прямого table DML
и exact `SECURITY DEFINER` allowlist. Credential material не передаётся Core и
не попадает в HTTP, события, логи или queue payload.

### Межкомпонентные взаимодействия

- Browser обращается только к Core.
- Core создаёт и читает Execution commands через один versioned internal
  boundary.
- Execution публикует normalized domain results в Core через один scoped
  internal boundary; прямой произвольный доступ Execution к Core tables
  запрещён.
- BullMQ остаётся transport для execution work. NATS сохраняется только для
  действительно durable asynchronous delivery, пока отдельный ADR не докажет
  эквивалентность более простого outbox transport.
- Старые SEO Data/Realtime internal routes сохраняются лишь на bounded
  compatibility window и удаляются после переключения всех callers.

### SQL policy

- Prisma Client является стандартом для CRUD, relations, aggregates и
  optimistic version updates.
- Статический сложный read SQL переносится в Prisma TypedSQL после
  type-generation и regression/plan проверки.
- `$queryRawUnsafe`/`$executeRawUnsafe` запрещены.
- Row/advisory locks, `SKIP LOCKED`, PostgreSQL functions/triggers,
  permissions, data migrations и database-specific indexes остаются
  parameterized SQL с узкими adapters и migration tests.
- SQL удаляется только при доказанной эквивалентности concurrency,
  idempotency, query plan и affected-row semantics.

## Миграция

Переход выполняется expand/contract без big-bang deploy.

1. Зафиксировать contract tests, route inventory, data counts/checksums и
   runtime latency/error baseline.
2. Создать Core composition boundary и перенести SEO Data domain modules за
   in-process ports, сохраняя старые internal HTTP adapters как compatibility
   facade.
3. Создать `app_db` schemas и replayable migration, перенести `platform_db`,
   `seo_data_db` и `realtime_db` с проверкой counts/checksums/constraints.
4. Переключить Core Prisma access и удалить Core-internal HTTP/tokens после
   consumer audit.
5. Перенести Realtime control data в `app_db`; gateway и Web Push sender
   оставить разными process roles с минимальными DB grants.
6. Переименовать Jobs/Integrations boundary в Execution без изменения
   credential/external-operation semantics; сократить его public surface до
   единого Core-facing API.
7. После shadow/read comparison и rollback drill удалить legacy deployables,
   databases, routes и secrets.

Каждый шаг имеет собственную forward migration и rollback до удаления legacy
источника. Dual write не используется без durable reconciliation ledger;
предпочтительны snapshot copy, bounded write pause и atomic routing cutover.

## Последствия

Положительные:

- два data-ownership components вместо четырёх;
- меньше HTTP hops, service credentials и DTO/parser boilerplate;
- Core получает foreign keys и транзакции для единого business action;
- worker и realtime performance масштабируется process profiles;
- credential/external-operation blast radius остаётся изолированным.

Ограничения и риски:

- `app_db` становится более крупной failure domain;
- schema consolidation требует проверенной migration/rollback процедуры;
- Core modules обязаны сохранять явные dependency rules, иначе получится
  неструктурированный монолит;
- до завершения contract-фазы временно существуют legacy routes/databases;
- физическое удаление старых boundaries допускается только после production
  observation window и сверки authoritative data.

## Реализованный этап

На 5 августа 2026 года выполнен совместимый application cutover:

- production composition root находится в `backend-core`;
- Platform API и SEO Data запускаются одним процессом, а API использует
  in-process transport вместо TCP для SEO-вызовов;
- порт `4001` и internal SEO routes сохранены для Execution workers;
- Realtime и Web Push запускаются child roles того же Core artifact;
- Compose и single-node VPS runtime больше не запускают отдельный SEO Data
  deployable;
- production runtime artifacts сокращены до Core и Execution;
- standalone entrypoints source-пакетов удалены после успешного deploy/runtime
  smoke; единственные Core entrypoints находятся в `backend-core`.

Data cutover ещё не выполнен: `platform_db`, `seo_db` и `realtime_db` остаются
раздельными compatibility databases с прежними least-privilege roles. Их
физическое объединение допускается только отдельной replayable migration со
сверкой counts/checksums/constraints и rollback drill; это не блокирует уже
выполненное сокращение deployable boundaries.
