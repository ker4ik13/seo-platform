# Системная архитектура, репозитории и Dokploy

## 1. Архитектурный стиль

Целевая архитектура — ограниченный набор доменных микросервисов с отдельным владением данными. Не допускается дробление на сервис для каждой сущности.

Основные правила:

- сервис имеет бизнес-границу и владельца данных;
- прямой доступ одного сервиса к таблицам другого запрещён;
- синхронное взаимодействие — HTTP/gRPC через внутреннюю сеть;
- асинхронное — NATS JetStream;
- jobs — BullMQ/Redis;
- согласованность между сервисами — eventual consistency;
- финансовые и критические изменения используют outbox/inbox;
- публичный трафик проходит через API gateway.

## 2. Общая схема

```mermaid
flowchart LR
    U["Пользователь"] --> T["Traefik / Dokploy"]
    T --> WEB["Unified Next.js / public + /app + docs"]
    T --> ADM["Admin Next.js"]
    T --> API["Platform API / Gateway"]
    T --> RT["Realtime service"]

    API --> COREDB[("platform_db")]
    API --> SEO["SEO Data service"]
    API --> JOB["Jobs & Integrations service"]
    API --> BILL["Billing modules"]

    SEO --> SEODB[("seo_db")]
    JOB --> JOBDB[("jobs_db")]
    JOB --> REDIS[("Redis / BullMQ")]
    RT --> REDIS
    RT --> RTDB[("realtime_db")]

    API <--> NATS["NATS JetStream"]
    SEO <--> NATS
    JOB <--> NATS
    RT <--> NATS

    JOB --> S3[("S3 / MinIO")]
    SEO --> S3
    RT --> S3
    WEB --> DIRECTUS["Directus"]
    DIRECTUS --> CMSDB[("directus_db")]
```

## 3. Репозитории

Канонический исходный код хранится в одном GitHub monorepo. Каталоги ниже
являются package, deployable и data-ownership boundaries, а не вложенными
Git-репозиториями или submodules. Существовавшие до консолидации истории
импортированы без squash; решение и обратный путь через `git subtree split`
зафиксированы в `ADR-2026-037`.

Общий репозиторий не разрешает прямые межсервисные импорты доменной логики,
доступ к чужой БД или совместные migrations. Независимая сборка и
масштабирование процессов сохраняются.

### 3.1. `platform-web`

- единый Next.js web-продукт;
- публичный сайт, статьи и локализованные SEO-страницы;
- индексируемый `/tools` и временные noindex tool results;
- `/docs` и generated `/docs/api`;
- защищённое приложение в `/app`;
- Directus SDK только в public/docs server boundary;
- design system package;
- TanStack Query/Table/Virtual;
- ECharts;
- Tiptap;
- generated API client;
- Socket.IO/Hocuspocus clients;
- Playwright.

Route groups обязаны изолировать caching и data access:

- `app/(public)` — cacheable/ISR страницы без tenant data;
- `app/tools` — индексируемый каталог и public tool UI;
- `app/docs` — документация;
- `app/app` — authenticated, private/no-store;
- server-only Directus client не импортируется в client bundles;
- project Toolbox и public Toolbox используют общий generated API client и
  capability metadata, а не дублируют бизнес-логику.

На старте это один deployable. При росте одно и то же image может запускаться
двумя runtime profiles за path-based routing (`public` и `app`), чтобы всплеск
SEO-трафика или anonymous Toolbox не снижал доступность `/app`. Кодовая база,
домен и release artifact при этом остаются общими.

### 3.2. `platform-admin`

- Next.js internal admin;
- отдельный auth audience;
- generated admin API client;
- high-risk action confirmation;
- audit views.

### 3.3. `platform-api`

NestJS:

- public API gateway/BFF;
- auth and sessions;
- accounts;
- workspaces;
- roles/access;
- projects;
- billing and plans;
- support/admin API;
- audit;
- API keys/webhooks registry;
- authoritative rank execution grant issuer и immutable decision receipts;
- public Toolbox orchestration и anonymous entitlement;
- orchestration to other services.

Database: `platform_db`.

### 3.4. `platform-seo-data`

NestJS:

- semantics;
- groups/clusters/tags;
- custom columns;
- pages;
- competitors;
- positions/read models;
- SERP parsed data;
- analytics aggregates;
- issues;
- Radar page snapshots/diffs и sitemap models;
- Magnet staging/read models;
- versioning;
- heavy domain queries.

Database: `seo_db`.

### 3.5. `platform-jobs-integrations`

NestJS monorepo/repository с несколькими entrypoints:

- job API;
- credential management/validation command API;
- scheduler;
- import/export worker;
- immutable rank manifest preparation/recovery worker;
- ranking/SERP worker;
- frequency worker;
- competitor worker;
- crawl worker;
- Radar scheduler/polite crawl worker;
- sitemap generation worker;
- Magnet sync worker;
- public Toolbox low-priority worker profile;
- report worker;
- connector registry;
- credential validation connector worker;
- credential broker client;
- usage metering.

Database: `jobs_db`; Redis/BullMQ; S3.

Workers развёртываются независимо из одного репозитория и одного или нескольких image targets.

В текущем срезе `src/main.ts` запускается с credential role `MANAGEMENT`, а
`src/connector-worker.main.ts` — с role `EXECUTION`. HTTP-процесс принимает
create/rotate/revoke/validation commands, но не обращается к provider;
connector worker не открывает входящий HTTP listener и не получает credential
API token или fingerprint keyring. Между ними передаётся только канонический
PostgreSQL Job и BullMQ payload с `jobId`. Connector worker использует отдельный
PostgreSQL login из `JOBS_CONNECTOR_DATABASE_USER` /
`JOBS_CONNECTOR_DATABASE_PASSWORD`. Для freshly provisioned non-owner role
permission component выдаёт только требуемые `SELECT` и перечисленные
column-level `UPDATE` grants внутри `jobs_db`, не выдавая worker-у
`INSERT`/`DELETE`/DDL.
После jobs migration one-shot component `jobs-connector-db-permissions`
идемпотентно создаёт/ужесточает эту роль через
`postgres/permissions/jobs-connector.sql` и fail-closed отклоняет
привилегированную роль, membership или ownership объектов кластера; worker
стартует только после его успеха.
Этот script гарантирует выданные privileges внутри `jobs_db`, но не является
доказательством полной изоляции уже существующего login: `PUBLIC CONNECT` к
другим databases и ранее выданные direct grants остаются residual risk.
Production provisioning обязан создавать fresh non-owner role, выполнять
cluster-wide grant audit и ограничивать доступ через `pg_hba` либо отдельную
cluster boundary.
Management и execution пока используют общий Redis password; до production
для connector worker требуется отдельный Redis ACL либо изолированный instance.

`src/rank-worker.main.ts` является отдельным preparation/recovery process:
credential role `DISABLED`, только `jobs_db`, Redis, internal SEO Data URL и
выделенные `JOBS_TO_SEO_RANK_TOKEN` и
`JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`. Последний также получает только
Platform API; generic Jobs HTTP и остальные worker processes его не получают.
Rank-worker не получает HTTP/internal/vault, NATS, S3, SMTP или provider
credentials, не публикует port и в текущем Dokploy Compose подключён только к
`internal`. Его bounded grant client сохраняет intent/decision и атомарно
создаёт secret-free `CONSUMED/READY_TO_SUBMIT` scoped execution, но dispatcher
его ещё не вызывает, connector claim отсутствует и live submit явно выключен.
Перед live provider execution для connector process создаётся минимальная
отдельная PostgreSQL role с SECURITY DEFINER-only access. Env изоляция сама
по себе не заменяет DB grants.

### 3.6. `platform-realtime`

- NestJS Socket.IO gateway;
- Redis adapter;
- presence;
- collaborative table signals;
- comments/notifications delivery;
- Hocuspocus/Yjs server;
- report live updates.

Database: `realtime_db`; Redis; S3.

### 3.7. `platform-contracts`

Отдельный versioned package внутри monorepo, готовый к публикации в package
registry:

- OpenAPI specs;
- AsyncAPI/event schemas;
- JSON Schema;
- generated TypeScript clients;
- error catalog;
- shared identifiers;
- compatibility tests.

Не содержит доменной бизнес-логики.

### 3.8. `platform-infrastructure`

- Dokploy Compose/Stack definitions;
- environment templates;
- Traefik settings;
- monitoring;
- backups;
- CI/CD workflows;
- runbooks;
- disaster recovery;
- migration orchestration.

`platform-marketing` и `platform-app` являются миграционными источниками до
завершения переноса в `platform-web`. Новая функциональность в них не
добавляется. История `platform-app` сохранена в общем Git graph после
верифицированной консолидации; каталог можно удалить только отдельным
решением после проверки переноса нужных артефактов.

## 4. Почему сервисов четыре

Backend ограничивается:

1. platform/API;
2. SEO data;
3. jobs/integrations;
4. realtime.

Этого достаточно для:

- независимого масштабирования workers;
- изоляции тяжёлых SEO-данных;
- отдельного real-time lifecycle;
- независимого core/billing;
- приемлемой сложности для небольшой команды.

Выделение billing, notifications или connector в отдельный сервис допускается только после появления независимой команды, нагрузки или требований безопасности.

## 5. Стек

### Runtime

- Node.js 24 LTS;
- TypeScript strict;
- pnpm;
- pinned lockfiles.

### Frontend

- Next.js Active LTS;
- React;
- TanStack Query;
- TanStack Table/Virtual;
- ECharts;
- Tiptap;
- i18n library;
- accessible UI primitives.
- один web repository для public/docs/tools и `/app`;
- route-level cache/security policies вместо двух расходящихся frontend.

### Backend

- NestJS;
- Fastify adapter;
- Prisma ORM;
- Prisma Migrate;
- OpenAPI;
- Socket.IO;
- Hocuspocus/Yjs.

### Data

- PostgreSQL 18.x;
- Redis;
- NATS JetStream;
- S3-compatible storage; рекомендуемый production-вариант первого этапа — Yandex Object Storage;
- MinIO допускается для local development и изолированных тестов, но не как единственная production/offsite копия;
- optional PgBouncer.

### Observability

- OpenTelemetry;
- Prometheus;
- Grafana;
- Loki;
- Grafana Alloy;
- Tempo подключается не позднее появления устойчивых межсервисных production flows;
- Uptime Kuma либо внешний независимый uptime check;
- Sentry-compatible error tracking.

## 6. Владение данными

| Домен | Владелец |
|---|---|
| пользователи, сессии, workspace, RBAC | platform-api |
| проекты как identity и настройки верхнего уровня | platform-api |
| semantic core, pages, rankings, competitors | seo-data |
| jobs, schedules, connectors, usage | jobs-integrations |
| comments, presence, Yjs metadata, notification policy, browser push devices, deliveries | realtime |
| subscriptions, ledger, plans | platform-api billing modules |
| CMS content | Directus |

Межсервисные IDs — UUIDv7. Внешняя ссылка не сопровождается DB foreign key между databases.

## 7. Синхронные вызовы

Допускаются для:

- authorization decision;
- чтения небольшой актуальной конфигурации;
- estimate;
- запуска команды;
- health/capabilities.

Правила:

- timeout;
- retry только идемпотентных calls;
- circuit breaker;
- correlation ID;
- service authentication;
- no long-running synchronous calls.

## 8. Асинхронные события

События:

- immutable fact в прошедшем времени;
- event ID;
- event version;
- occurredAt;
- producer;
- trace ID;
- workspace/project IDs;
- payload schema.

Примеры:

- `WorkspaceCreated`;
- `ProjectArchived`;
- `SemanticImportCommitted`;
- `KeywordsChanged`;
- `JobCompleted`;
- `CredentialInvalidated`;
- `UsageRecorded`;
- `BalanceReservationFailed`;
- `ReportPublished`;
- `RoleChanged`.

## 9. Outbox/inbox

- Изменение domain data и outbox event выполняются в одной PostgreSQL transaction.
- Publisher отправляет событие в NATS и отмечает доставку.
- Consumer сохраняет inbox event ID до side effect.
- Доставка at-least-once.
- Consumers идемпотентны.
- DLQ и replay доступны operations.

## 10. Prisma

- У каждого backend repository своя Prisma schema и migrations.
- `prisma migrate deploy` выполняется отдельным release step.
- Production migrations не запускаются автоматически каждым replica.
- Сгенерированные SQL migrations проверяются вручную.
- Partitioning, indexes, extensions, triggers и views добавляются custom SQL.
- `db push` запрещён в staging/production.
- Миграции, применённые в production, не редактируются.

## 11. Работа с большими данными

Prisma используется для:

- transactional CRUD;
- permissions metadata;
- конфигураций;
- обычных entity queries.

Raw SQL/driver используется для:

- PostgreSQL `COPY`;
- staging merge;
- partition management;
- materialized views;
- крупные analytics;
- bulk update;
- specialized indexes.

Raw SQL централизуется в repository classes, параметризуется и тестируется. Произвольный SQL в controllers запрещён.

## 12. Cache

Redis используется для:

- sessions auxiliary state/revocation;
- permission cache;
- query/result cache;
- rate limits;
- BullMQ;
- Socket.IO adapter;
- presence;
- distributed locks с ограниченным TTL.

Кеш не является источником истины. Каждый key имеет namespace, version и TTL.

## 13. Object storage

Buckets/prefixes:

- imports;
- exports;
- raw-serp;
- reports;
- attachments;
- yjs-snapshots;
- backups.

Правила:

- private by default;
- signed URLs;
- encryption at rest;
- checksum;
- content type validation;
- lifecycle/retention;
- malware scanning;
- object key не содержит исходное имя пользователя без sanitization.

## 14. Dokploy environments

- local;
- development;
- staging;
- production.

Production и staging используют разные databases, buckets, Redis, NATS, OAuth apps и secrets.

## 15. Базовая VPS-топология

### Старт

VPS 1:

- Dokploy;
- Traefik;
- frontend;
- API/realtime.

VPS 2:

- workers;
- Redis;
- NATS.

VPS 3:

- PostgreSQL;
- object storage либо внешний S3;
- backups.

Допустимо начать с меньшего числа VPS, но PostgreSQL и backups не должны зависеть только от локального диска единственного application VPS.

### Рост

- отдельный build server;
- несколько application servers;
- отдельные worker pools;
- PostgreSQL primary/replica;
- Redis HA;
- внешний S3;
- отдельный monitoring server.

## 16. Dokploy deployment

- Каждый deployable component создаётся как Dokploy Application или Compose service.
- Публичные domains настраиваются через Dokploy/Traefik.
- Внутренние сервисы не публикуют host ports.
- Используются private/isolated networks.
- Jobs API и outbound-required workers используют isolated internal network
  и отдельную сеть без опубликованных портов для исходящих
  S3/SMTP/provider соединений; подключение к ней не должно давать входящий
  public route. Rank preparation worker остаётся только в `internal`.
- Credential connector принимает только versioned application allowlist
  provider origins; до high-assurance production outbound network
  дополнительно ограничивается host firewall или egress proxy.
- Browser push management использует отдельный Platform API → Realtime token.
  Realtime HTTP получает только VAPID public key, exact push endpoint origin
  allowlist и отдельные encryption/fingerprint keyrings; VAPID private key
  этому process, Platform API и Web не выдаётся.
- Web Push registration и delivery включаются раздельно. Текущий Compose
  передаёт `WEB_PUSH_REGISTRATION_ENABLED=false` по умолчанию и не содержит
  sender/VAPID private key.
- Images публикуются в private registry, например GHCR.
- Tag immutable: git SHA + release version.
- `latest` не используется для production deploy.
- Health checks обязательны.
- Graceful shutdown обязателен.
- Workers перестают брать новые jobs и завершают/чекпоинтят текущие.

## 17. CI/CD

На pull request:

- format;
- lint;
- TypeScript;
- unit;
- integration;
- schema validation;
- migration lint;
- container build;
- dependency/security scan.

На staging:

- deploy migrations;
- deploy services;
- smoke;
- contract tests;
- E2E;
- visual tests.

На production:

- approval;
- backup check;
- expand-compatible migrations;
- rolling deploy;
- smoke;
- monitoring;
- rollback application if needed.

## 18. Миграционная совместимость

Используется expand/migrate/contract:

1. добавить совместимые columns/tables;
2. deploy code supporting old/new;
3. backfill;
4. переключить reads/writes;
5. удалить legacy позднее.

Breaking schema migration и deploy приложения одним необратимым шагом запрещены.

## 19. Availability

Цель:

- приложение/API 99,9% месячной доступности;
- jobs могут деградировать отдельно;
- outage одного provider не должен останавливать остальное приложение;
- CMS outage не должен немедленно отключать уже опубликованный сайт благодаря cache/static output.

## 20. Масштабирование

- API stateless;
- WebSocket replicas через Redis adapter;
- websocket-only transport либо sticky sessions;
- workers горизонтально по queue;
- concurrency настраивается;
- heavy reports/crawl изолированы;
- read replicas допускаются для аналитики;
- partition pruning обязательно для snapshots.

## 21. Конфигурация

- typed environment validation на startup;
- секреты не имеют defaults;
- public config отделён от server config;
- feature flags не заменяют permissions;
- environment variables документируются;
- runtime secrets не попадают в frontend bundles.

## 22. Архитектурные запреты

- shared database tables между сервисами;
- синхронная цепочка более трёх сервисов для пользовательского запроса;
- хранение API secrets в job payload/log;
- выполнение тяжёлой операции в HTTP request;
- бесконтрольные cron внутри каждого replica;
- production `prisma db push`;
- cross-service distributed transaction;
- использование Redis как единственного хранилища результата.
