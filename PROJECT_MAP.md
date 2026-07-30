# Карта проекта

Последнее обновление: 30 июля 2026 года

Текущий инкремент: manual BYOK rank execution foundation
Статус: versioned tracking context, provider-free оценка и immutable
execution manifest в SEO Data завершены. Estimate хранится в `jobs_db`,
доступен при read-only и не вызывает provider, decrypt, Job/BullMQ, списание
или event. SEO Data уже атомарно seal-ит bounded keyword snapshots в
immutable header/chunks/entries и защищает active semantic dedup. Jobs теперь
durable создаёт `PREPARING` Job и immutable sidecar, seal-ит manifest через
изолированный rank-worker, восстанавливает потерянные BullMQ notifications,
сериализует cancel и закрывает sealed cancellation через SEO Data finalize.
Неоднозначный исход ограниченно повторяется exact-командой и затем становится
`ACTION_REQUIRED`, а не ложным `NOT_SEALED`. Public Platform API и
восстанавливаемый Web Job flow готовы. SEO Data принимает exact normalized
chunks, атомарно строит append-only snapshots/current projection, завершает
успешный/partial manifest с redacted outbox event и предоставляет internal
keyset history. Platform API публикует bounded read-only history proxy, а Web
— private/noindex экран с фильтрами и cursor-дозагрузкой. Platform API теперь
имеет protected issuer foundation одноразового 30-секундного execution grant:
он повторно проверяет owned lifecycle/RBAC state под row locks и сохраняет
immutable exact decision receipt. Jobs добавил bounded issuer client и
durable intent/consume: exact `REQUESTED` записывается до HTTP, retryable ambiguity
повторяет тот же request/idempotency key, а решение сохраняется как `DENIED`,
`EXPIRED`, `GRANTED_PENDING_CONSUME` либо `REJECTED_LOCAL`. Неистёкшее
положительное решение теперь под тем же canonical lock order атомарно
переходит в `CONSUMED` вместе с единственным secret-free
`rank_connector_executions/READY_TO_SUBMIT`. Строка связывает exact
Job/item/grant/manifest/binding/route/credential-version evidence, но не
содержит credential material. Default-closed SECURITY DEFINER claim DDL уже
переводит eligible row в bounded pre-network `CLAIMED` и возвращает только
одну exact encrypted credential projection после full current-graph recheck.
Exact deploy-time connector permissions теперь выдают только broker/claim/
authorize signatures без table DML. Submit authorization повторно блокирует
полный current graph, сверяет owner/token/lease generation/row version и
атомарно фиксирует `SUBMITTING` с durable marker до возможных network bytes.
Runtime caller, immutable provider request, submit/status/fetch persistence и
normalized result producer ещё отсутствуют.
Production policy и submit gate остаются fail-closed; live Arsenkin submit
выключен до прохождения contract/security gates ADR-2026-034.

Параллельный dependency-free срез browser Web Push device lifecycle
реализует ADR-2026-035: профиль владеет устройствами, Platform API управляет
ими через отдельный Realtime token, secret material хранится в
`realtime_db` под AES-256-GCM и отдельными HMAC fingerprints, а Web
регистрирует Service Worker только для `/app/`. IndexedDB schema v2 хранит
монотонные reconciliation generations; foreground завершает только exact
generation через CAS и не теряет более новое изменение Service Worker/другой
вкладки. Реальная email/Web Push доставка и test send остаются выключены.

Dependency-free identity producer по ADR-2026-036 добавляет
`identity.session-family.revoked.v1`: Platform API terminal-отзывает целые
session families и атомарно пишет redacted outbox event. Все session lifecycle
writers одного пользователя используют общий PostgreSQL advisory transaction
lock; выдача повторно проверяет актуальные `user.version + ACTIVE`. Realtime
уже содержит dependency-free application handler: exact event validation,
scoped inbox receipt, durable revoked-family tombstone, terminal device
revoke и fail-closed tombstone check при upsert используют один user advisory
lock. Durable JetStream publisher/transport subscription и global
session-expiry sweeper ещё отсутствуют.

Межсервисный HTTP hardening удалил legacy `INTERNAL_API_TOKEN`: каждый
обычный caller/audience pair теперь имеет отдельный credential, а legacy env
останавливает startup. Dedicated vault, rank manifest/result/grant и Web Push
device boundaries сохранены отдельно. Все internal clients запрещают
redirect, а service-token guards требуют один strict header. Перед шестью
process types, которые получают service credentials (`platform-api`,
`seo-data`, Jobs HTTP, import, rank и realtime), Compose выполняет
network-less one-shot `service-token-preflight`: он глобально проверяет девять
service tokens и `RANK_HISTORY_CURSOR_KEY` на pairwise distinct без вывода
значений или хэшей. Jobs image дополнительно получил явные process roles:
HTTP имеет полный management-набор только для своей роли, import —
DB/Redis/S3/SEO Data, inspection —
DB/Redis/S3/malware, system — Redis-only; rank и connector сохраняют прежние
строгие specialized allowlists. Это закрывает credential fan-out через env,
но не означает полной production готовности: Redis ACL/observability,
durable events, provider runtime и остальные release gates остаются.

Этот файл является короткой оперативной картой. Полные требования находятся в [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).

## 1. Инварианты

- Tenant: `workspace`; проект всегда принадлежит одному workspace.
- Backend-контуры: platform API, SEO data, jobs/integrations, realtime.
- Каждый backend владеет своей PostgreSQL database.
- Межсервисные IDs — UUIDv7; cross-database foreign keys запрещены.
- Синхронные связи — internal HTTP; надёжные события — NATS JetStream + outbox/inbox.
- Долгие операции — BullMQ/Redis.
- Большие файлы — S3-compatible object storage.
- Email подключается через port/adapter и может быть выключен.
- Frontend не обращается к domain services напрямую: публичный вход — platform API.
- Platform-paid SEO API запрещён без price book, budget и коммерческого права.
- Основной домен обслуживает единый `platform-web`; `/app` private/noindex.
- Public/project Toolbox и API используют один capability registry.
- Billing никогда автоматически не удаляет проекты и не скрывает историю.
- Чек НПД создаётся только для verified успешного платежа ЮKassa.
- Настройки каналов уведомлений принадлежат профилю пользователя; проектные
  подписки задают типы работ и могут только сужать/переопределять профиль.
- Browser Push device принадлежит профилю, а не проекту; project rule выбирает
  события/канал, но не получает endpoint или browser keys.
- Terminal session revoke применяется ко всей refresh family и атомарно пишет
  `identity.session-family.revoked.v1`; обычная rotation и access-token TTL
  terminal event не создают.
- Tracking context не хранит provider/credential/schedule: его immutable
  search configuration принадлежит SEO data, routing — Jobs, schedule —
  automation.
- Rank manifest принадлежит SEO Data, остаётся immutable после seal и
  закрывается без физического удаления после terminal finalize.

## 2. Development workspace

Канонический source хранится в одном GitHub monorepo по ADR-2026-037. Каждый
`platform-*` каталог остаётся независимой package/deployable/data-ownership
boundary и при реальной операционной необходимости может быть снова выделен
через `git subtree split`. Общий Git не разрешает межсервисный доступ к БД или
импорт доменной реализации вместо contracts.

| Каталог | Ответственность | Deployable |
|---|---|---|
| `platform-contracts` | HTTP/event/error contracts без бизнес-логики | npm package |
| `platform-api` | auth, workspace, project, billing, API gateway | да |
| `platform-seo-data` | semantics, pages, positions, competitors | да |
| `platform-jobs-integrations` | jobs, workers, connectors, S3/email ports | несколько entrypoints |
| `platform-realtime` | WebSocket presence/collaboration delivery | да |
| `platform-web` | public site, Toolbox, API docs и приложение `/app` | да |
| `platform-admin` | незавершённый internal-only административный shell | да, без внешнего ingress |
| `platform-infrastructure` | Compose/Dokploy, monitoring, runbooks | конфигурация |
| `.github/workflows/ci.yml` | Node.js 24 workspace quality gate | GitHub Actions |
| `docs/technical-spec` | нормативное ТЗ | нет |
| `semaflow-seo-platform-design` | исходный статический дизайн-прототип | нет |

## 3. Текущие связи

```text
platform-web ──────┐
platform-admin ────┼──> platform-api
                               │
                               ├──> platform-seo-data
                               ├──> platform-jobs-integrations
                               └──> platform-realtime

HTTP/domain backends <──> NATS
jobs/realtime <──> Redis
jobs <──> S3
upload inspection worker ──> ClamAV
import worker ──> S3 + partitioned staging in jobs_db
import worker ──internal HTTP──> seo-data semantic core
connector worker ──> jobs_db + BullMQ + allowlisted provider endpoints
platform-web public/docs <──> Directus
```

Platform API синхронно передаёт обычные upload/import-команды в
jobs-integrations через internal HTTP с
`PLATFORM_API_TO_JOBS_TOKEN` и проверенным tenant/actor context. Credential,
binding и связанные rank command endpoints используют отдельный
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`, доступный только Platform API и
jobs-integrations HTTP; general token vault не открывает.
Проверка credential создаётся как канонический `Job` в PostgreSQL; BullMQ
получает только `jobId`. Отдельный execution-role connector worker забирает
lease и перед вызовом провайдера повторно проверяет workspace, material
version, connector version и состояние credential.
Execution login не читает `jobs` или `integration_credentials` напрямую:
allowlisted `SECURITY DEFINER` broker выдаёт due IDs, lease с одноразовым
token и только encrypted projection credential, привязанную к точной
validation job. Success/provider failure завершают Job и credential атомарно,
а local decrypt/KEK failures используют отдельный job-only finish.
Project binding читается и изменяется через Platform API, а хранится только
в jobs/integrations. Public body не задаёт tenant/actor context; Platform API
передаёт его через тот же dedicated credential boundary и строго проверяет
scope/safe response перед возвратом в Web.
Tracking context читается и изменяется через Platform API, а хранится только
в SEO Data. Platform API передаёт проверенный tenant/actor context по internal
HTTP с `PLATFORM_API_TO_SEO_DATA_TOKEN`; SEO Data повторно сверяет
route/project scope и атомарно пишет redacted outbox event вместе с domain
change. Jobs HTTP и import обращаются к SEO Data только с отдельным
`JOBS_TO_SEO_DATA_TOKEN`. Realtime general HTTP принимает от Platform API
`PLATFORM_API_TO_REALTIME_TOKEN`, а browser device lifecycle — отдельный
notification credential.
Оценка готовности позиций вызывается Web через Platform API. Platform API
загружает trusted project/workspace/access snapshot и передаёт команду в
Jobs/integrations через dedicated credential boundary. Jobs запрашивает у
SEO Data атомарный bounded scope, читает только allowlisted connector
metadata и сохраняет immutable redacted receipt в `rank_estimates`. Exact
replay не продлевает TTL и не повторяет SEO read; estimate не является
execution grant.
Перед будущим provider submit Jobs должен запросить Platform API через
`POST /internal/v1/workspaces/:workspaceId/projects/:projectId/rank-execution-grants`.
Issuer требует exact single-value request/tenant/actor/idempotency headers,
сверяет их с path/body и сохраняет immutable decision в
`platform_db.rank_execution_grant_receipts`. Exact replay возвращает исходный
receipt даже после expiry. Jobs теперь до вызова issuer сохраняет exact
request/scope/evidence и stable idempotency key в
`jobs_db.rank_execution_grant_attempts`, а затем под теми же canonical graph
locks проверяет решение и DB clock. Отказы заканчиваются persisted
`DENIED/EXPIRED/REJECTED_LOCAL`; валидный grant проходит промежуточный
`GRANTED_PENDING_CONSUME` и атомарно создаёт единственную scoped
`rank_connector_executions` row вместе с `CONSUMED`. Ни эта row, ни consume
не разрешают provider call. SECURITY DEFINER claim повторно проверяет
lifecycle/credential/control и создаёт только pre-network lease. Exact
authorize operation повторяет full graph/control/fence recheck и commit-ит
`SUBMITTING` с one-way marker; permission script выдаёт обе функции connector
login, но runtime process path их пока не вызывает.
Platform API теперь имеет глобальную fail-safe HTTP response policy: кроме
exact public GET/HEAD health/system allowlist, auth/tenant/internal, unknown,
parser/guard/exception/404 ответы принудительно получают
`Cache-Control: private, no-store` и merge-safe `Vary`. Все ответы получают
nosniff/frame/referrer/permissions headers; production HSTS зависит от
effective HTTPS через ровно один доверенный reverse-proxy hop.
История позиций читается Web только через same-origin BFF и public Platform
API `GET /api/v1/projects/:projectId/rank-history`. Platform API проверяет
session, `ranking.view` и tenant scope, затем передаёт trusted context и
bounded UTC/filter/cursor query во внутренний read model SEO Data. Чтение
остаётся доступным для архивного проекта и billing read-only workspace.
Остальная межсервисная бизнес-коммуникация пока не включена: подключены
transport и health/readiness, таблицы outbox/inbox созданы. Durable публикация
событий начинается в следующем вертикальном срезе.

## 4. Порты по умолчанию

| Компонент | Порт |
|---|---:|
| unified web | 3000 |
| admin | 3002 |
| platform-api | 4000 |
| seo-data | 4001 |
| jobs-integrations API | 4002 |
| realtime | 4003 |
| Directus | 8055 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS client/monitor | 4222 / 8222 |
| ClamAV `clamd` (только internal network) | 3310 |

## 5. Конфигурация

- Корневой `.env.example` документирует remote compose variables.
- Каждый сервис имеет собственный `.env.example`.
- Runtime validation должна завершать startup при отсутствии обязательной переменной.
- `S3_ENABLED=false` и `EMAIL_ENABLED=false` разрешены до подключения провайдеров.
- Имена access/session/CSRF cookies в `platform-web` и `platform-api` обязаны
  совпадать; публичным для JavaScript является только имя CSRF cookie.
- Directus использует local media volume до переключения
  `DIRECTUS_STORAGE_DRIVER=s3`; application uploads сразу имеют S3 adapter.
- Production secrets задаются только в Dokploy.
- Legacy `INTERNAL_API_TOKEN` удалён из deploy input и отклоняется startup
  всех четырёх backend. General internal HTTP разделён на exact pairs:
  `PLATFORM_API_TO_SEO_DATA_TOKEN` (Platform API → SEO Data),
  `PLATFORM_API_TO_JOBS_TOKEN` (Platform API → Jobs HTTP),
  `JOBS_TO_SEO_DATA_TOKEN` (Jobs HTTP/import → SEO Data) и
  `PLATFORM_API_TO_REALTIME_TOKEN` (Platform API → Realtime).
- `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN` отличается от general tokens и
  выдаётся только Platform API и credential-capable jobs/integrations HTTP
  process.
- Service-token validation принимает только `32..512` visible ASCII без
  whitespace/control/comma, отклоняет example placeholders и reused values.
  Guard принимает один exact header и сравнивает credential timing-safe;
  internal clients используют `redirect: "error"`.
- Deploy-level `service-token-preflight` намеренно строже runtime validation:
  до запуска шести token-bearing processes он требует все девять service
  tokens и `RANK_HISTORY_CURSOR_KEY`, проверяет их глобальную pairwise
  distinctness и допускает только URL-safe `[A-Za-z0-9._~-]` длиной
  `32..512`. One-shot container не имеет сети, работает read-only с
  `cap_drop: ALL` и `no-new-privileges` и не пишет в output значения либо их
  хэши; ошибки называют только переменные.
- `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` защищает только internal issuer
  execution grants и отличается от всех остальных service tokens. Текущий
  Compose передаёт его только Platform API и выделенному rank-worker с
  bounded Jobs grant client. Generic Jobs HTTP, connector/import/inspection/
  system/migration, Web и остальные сервисы его не получают. Production
  Compose фиксирует `RANK_PROVIDER_SUBMIT_ENABLED=false`.
- `JOBS_TO_SEO_RANK_TOKEN` отличается от всех остальных service tokens и
  защищает seal/chunk boundary с plaintext keyword snapshots. До появления
  provider execution его получают только SEO Data HTTP и отдельный
  `rank-worker`; generic HTTP, connector, import, inspection, system и
  migration processes его не получают.
- `JOBS_TO_SEO_RANK_RESULT_TOKEN` защищает отдельную запись уже
  нормализованных результатов и не переиспользует preparation credential.
  Текущий Compose требует его, но передаёт только SEO Data: result producer
  ещё не подключён, а остальные процессы не получают этот secret.
- `RANK_HISTORY_CURSOR_KEY` — отдельный HMAC key непрозрачного history
  cursor. Текущий Compose требует и передаёт его только SEO Data; Platform
  API, Web, workers и migration processes key не получают.
- Rank-worker требует `RANK_PREPARATION_ENABLED=true`, отдельные bounded
  lease/dispatch/concurrency settings и lease минимум на пять секунд длиннее
  SEO Data timeout. Он запускается отдельным Dokploy process из того же image
  и fail-closed отклоняет generic/credential/NATS/S3/SMTP secrets.
- Jobs process roles проверяются config loader-ом fail-closed. HTTP получает
  DB/Redis/NATS/S3/SMTP, два нужных general tokens и management vault; import
  — DB/Redis/S3/SEO token; inspection — DB/Redis/S3/malware; system — только
  Redis. Rank и connector используют прежние strict allowlists и не получают
  general tokens.
- `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN` отличается от остальных
  service secrets и выдаётся только Platform API и Realtime HTTP для
  управления browser Web Push devices. Пример намеренно пуст, runtime
  отклоняет placeholder, а production Compose требует явно сгенерированное
  значение.
- Browser subscription material использует отдельные versioned keyrings
  `WEB_PUSH_SUBSCRIPTION_KEYS` (AES-256-GCM) и
  `WEB_PUSH_FINGERPRINT_KEYS` (HMAC-SHA-256). Их key material не
  переиспользуется, отображение version → bytes immutable, active rows
  проходят startup coverage guard.
- `WEB_PUSH_ENDPOINT_ORIGINS` является exact HTTPS origin allowlist.
  `WEB_PUSH_REGISTRATION_ENABLED=false` — безопасный default; VAPID private
  key не передаётся Platform API, Realtime HTTP, Web или текущему Compose.
- BYOK envelope encryption использует отдельный
  `INTEGRATION_CREDENTIAL_KEYS` KEK keyring; auth encryption key для него не
  переиспользуется. Request fingerprint использует второй независимый
  `INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS` keyring. Management-role HTTP
  process получает оба keyring для create/rotate, execution-role connector
  worker получает только KEK для расшифровки перед allowlisted provider call;
  generic migration/system/import/inspection workers не получают ни один.
  Привязка `keyVersion → KEK bytes` immutable: существующей версии запрещено
  присваивать другое значение. Startup проверяет не tenant credential sample,
  а immutable synthetic envelope из `integration_credential_kek_canaries`;
  таблица не содержит workspace, provider или credential identity.
- Runtime role guard работает fail-closed: `DISABLED` отклоняет credential
  secrets, а `EXECUTION` — management/fingerprint/internal/NATS и S3/SMTP
  secrets. Это проверка конфигурации, а не криптографическая изоляция.
- Connector worker требует `INTEGRATION_CREDENTIAL_ROLE=EXECUTION` и
  canonical DB username `jobs_connector` с отдельным вращаемым
  `JOBS_CONNECTOR_DATABASE_PASSWORD`, а также
  `INTEGRATION_VALIDATION_TIMEOUT_MS`, `INTEGRATION_VALIDATION_LEASE_SECONDS`,
  `INTEGRATION_VALIDATION_DISPATCH_SECONDS`,
  `INTEGRATION_VALIDATION_CONCURRENCY`. Lease должен быть строго длиннее
  provider timeout минимум на 2 секунды; startup проверяет инвариант.
- Jobs runtime processes используют `internal` для PostgreSQL/Redis/NATS и
  отдельную непубликуемую `outbound` network для S3/SMTP/provider HTTPS.
  Connector origins фиксированы в коде; production egress proxy/firewall
  остаётся дополнительным сетевым allowlist.
- `inspection` Compose profile запускает отдельные ClamAV и upload inspection
  worker; без доступного scanner файл fail-closed остаётся `UPLOADED`.

## 6. Внутренняя структура пакетов

Backend convention:

- `src/config` — единственная точка чтения и проверки env;
- `src/database` + `prisma` — Prisma adapter, schema и migrations владельца БД;
- `src/messaging` — NATS transport; domain code не импортирует transport напрямую;
- `src/health` — liveness/readiness;
- `src/system` — временный descriptor возможностей;
- `src/generated` и `dist` — генерируемые, не редактируются вручную.

Специализированные модули:

- `platform-api/src/identity` — account/session lifecycle, user-scoped
  advisory lock, whole-family terminal revoke/outbox и CSRF guards;
- `platform-api/src/common/uuid-v7.ts` — dependency-free RFC 9562 UUIDv7 для
  новых межсервисных session-family aggregate IDs;
- `platform-api/src/common/http-response-policy.ts` — глобальная exact-public-
  allowlist response boundary: private/no-store и merge-safe Vary для всех
  остальных route/error paths, общие security headers и production HSTS
  только при effective HTTPS от ближайшего доверенного proxy hop;
- `platform-jobs-integrations/src/internal/http-response-policy.ts` и
  `platform-seo-data/src/internal/http-response-policy.ts` — fail-safe
  private/no-store boundary для всех внутренних HTTP, parser/guard/error/404
  ответов с merge-safe Vary и security headers; оба internal-only сервиса не
  доверяют forwarded proxy headers;
- `platform-realtime/src/common/http-response-policy.ts` — edge HTTP/error/
  preflight boundary Realtime с принудительным private/no-store, merge-safe
  Vary, security headers и production HSTS только по effective HTTPS от
  ближайшего из одного доверенного proxy hop;
- `platform-api/src/identity/mfa.*`, `totp.*` — TOTP lifecycle, login
  challenge и recovery codes;
- `platform-api/src/authorization` — default-deny permission catalog и
  проверка tenant context;
- `platform-api/src/tenants` — workspace/project commands и queries;
- `platform-api/src/tenants/team.*` — приглашения, участники и проектные
  ограничения доступа;
- `platform-api/src/uploads` — project-scoped public upload commands;
- `platform-api/src/jobs` — internal HTTP client к jobs-integrations с
  отдельным general и credential audience token и запретом redirect;
- `platform-api/src/integrations` — workspace-scoped public catalog/credential
  commands и project-scoped connector settings с RBAC, CSRF, audit intent,
  idempotency и optimistic locking;
- `platform-api/src/imports` — project-scoped create/read orchestration с
  `semantic.import`/`semantic.view`;
- `platform-api/src/semantics` — public project-scoped keyword queries с
  `semantic.view`;
- `platform-api/src/rankings` — public tracking context CRUD/archive/restore
  и point keyword assignments с `ranking.view/configure`, CSRF,
  idempotency/OCC и audit, а также provider-free rank estimate с
  `ranking.view` и trusted lifecycle/access snapshot, public manual Job
  lifecycle, bounded read-only rank history proxy и protected fail-closed
  execution-grant issuer с immutable exact replay;
- `platform-contracts/src/api/rank-execution-grants.ts` — exact Jobs →
  Platform request/scope hash preimages, 30-second grant/decision contracts и
  redaction allowlist без binding/credential/secret IDs;
- `platform-api/prisma/migrations/20260729230000_rank_execution_grant_receipts`
  — immutable issuer decisions, exact idempotency/item-attempt keys,
  authoritative quota reservation и update/delete/truncate guards;
- `platform-jobs-integrations/prisma/migrations/20260729230100_rank_execution_grant_attempts`
  — durable exact Jobs intent/decision history, tenant-safe Job/Run/Item FK,
  immutable request identity, state matrix и delete/truncate guards;
- `platform-jobs-integrations/prisma/migrations/20260729230200_rank_connector_executions`
  — secret-free scoped execution rows, tenant Job/item/grant/connector FK,
  current-graph insert guard и deferred one-to-one atomic
  `CONSUMED ↔ READY_TO_SUBMIT` invariant;
- `platform-jobs-integrations/prisma/migrations/20260730101500_rank_connector_execution_claim`
  — default-closed control и immutable kill-switch version history, bounded
  `READY_TO_SUBMIT → CLAIMED` lease, full eligible-graph/canonical-lock
  SECURITY DEFINER claim и exact encrypted credential projection; `PUBLIC`
  execute отозван;
- `platform-jobs-integrations/prisma/migrations/20260730101600_integration_credential_validation_broker`
  — synthetic immutable KEK canaries и узкие SECURITY DEFINER due/claim/
  finish boundaries, которые убирают direct global vault read connector роли;
- `platform-jobs-integrations/prisma/migrations/20260730101700_rank_connector_submitting_enum`
  и `20260730101800_rank_connector_submit_authorization` — отдельный enum
  expansion, monotonic lease generation, one-way `CLAIMED → SUBMITTING`,
  full graph/control/fence authorization и durable may-have-started marker;
- `platform-contracts/src/api/rank-runs.ts` и `src/events/rankings.ts` —
  exact manual-run lifecycle, manifest/chunk, normalized ingest/finalize и
  redacted completion event contracts; manifest preimage builders
  используются Jobs и SEO Data, Job preparation/cancel и SEO Data
  ingest/finalize/completion outbox реализованы; provider-side normalized
  result producer остаётся следующей runtime-границей;
- `platform-contracts/canonical-json` — server-only RFC 8785 JCS subpath для
  одинаковых contract hash preimages в Jobs и SEO Data; root/browser export
  намеренно отсутствует;
- `platform-api/src/seo-data` — строго валидируемый internal read/command
  client к владельцу semantic core и tracking contexts;
- `platform-seo-data/src/rank-manifests` — dedicated-auth seal/chunk API,
  bounded preflight, immutable manifest state machine, hash verification и
  active semantic dedup;
- `platform-seo-data/src/rank-results` — dedicated-auth normalized chunk
  ingest, append-only snapshots/current projection, terminal finalize
  receipts/completion outbox и internal HMAC-cursor history;
- `platform-seo-data/prisma/migrations/20260729160000_rank_execution_manifests`
  — header/chunk/entry tables, provenance/immutability triggers и partial
  unique active-dedup index;
- `platform-api/src/notifications` — public profile/project notification
  preferences с CSRF, tenant authorization и optimistic locking, а также
  profile-scoped browser device lifecycle с recent-auth enable;
- `platform-api/src/realtime` — строго валидируемый internal client владельца
  notification policy и encrypted browser subscription storage;
- `platform-api/src/audit`, `src/outbox` — переиспользуемые transactional
  записи аудита и событий;
- `platform-jobs-integrations/src/queue` — BullMQ connection, system,
  `upload-inspection`, идемпотентная `integration-credential-validation` и
  DB-recoverable `rank-preparation` queues;
- `platform-jobs-integrations/src/storage` — S3 port, disabled и S3 adapters;
- `platform-jobs-integrations/src/malware` — scanner port, disabled adapter и
  потоковый `clamd` INSTREAM adapter;
- `platform-jobs-integrations/src/internal` — strict single-header
  `PlatformApiGuard` для general Platform API → Jobs HTTP-команд;
- `platform-jobs-integrations/src/uploads` — multipart lifecycle, opaque
  object keys, size verification, lease/heartbeat inspection и upload outbox
  events;
- `platform-jobs-integrations/src/imports` — потоковый CSV/TSV parser,
  Key Collector header mapping, raw/validated staging, lease/heartbeat,
  validation summary и chunked publisher;
- `platform-jobs-integrations/src/integrations` — allowlisted provider catalog,
  workspace-scoped envelope vault с per-record DEK, AES-256-GCM и versioned
  KEK, отдельный versioned HMAC fingerprint keyring, dedicated caller guard,
  synthetic immutable KEK canary, startup coverage guard, masked DTO,
  rotation, destructive secret overwrite при revoke, connector registry,
  narrow execution broker с token/version-fenced lease/finish operations и
  нормализованные project binding/route/create receipt;
- `platform-jobs-integrations/src/rank-estimates` — immutable provider-free
  estimate receipts, strict tenant/idempotency boundary, connector metadata
  projection и finite blockers без provider call/decrypt/queue;
- `platform-jobs-integrations/src/rank-runs` — internal create/get/cancel,
  immutable manifest command/hash, `rank_job_runs` sidecar, явная Job/seal
  state machine, canonical `Job → RankJobRun → JobItem → credential →
  validation Job → binding → route → grant attempt` lock order, bounded
  recovery, public-safe Job projection и durable execution-grant
  intent/consume; dependency-free provider lifecycle reducer фиксирует
  конечную state/event matrix и запрет auto-resubmit после ambiguous submit,
  но его DB persistence/runtime wiring ещё отсутствуют;
- `platform-jobs-integrations/src/platform-api` — bounded/no-redirect client
  issuer-а с dedicated token, exact envelope/request/scope hash validation,
  no-store check, response size и timeout limits;
- `platform-jobs-integrations/src/rank-worker.main.ts` — изолированный
  rank-preparation entrypoint с per-delivery lease owner, PostgreSQL
  dispatcher recovery и двумя выделенными manifest/grant rank tokens; grant
  service пока не подключён к dispatcher/provider execution;
- `platform-jobs-integrations/src/seo-data` — строго валидируемый internal
  HTTP client владельца semantic core и bounded rank-estimate scope;
- `platform-seo-data/src/semantic-imports` — нормализация, import receipts,
  идемпотентное применение chunks и semantic version;
- `platform-seo-data/src/keywords` — tenant-scoped keyword read model,
  trigram search, cursor pagination и derived `isTracked` по активным
  temporal assignments;
- `platform-seo-data/src/tracking-contexts` — logical context,
  immutable configuration versions, temporal keyword assignments,
  create receipts и transactional redacted outbox events;
- `platform-seo-data/src/rank-scopes` — атомарный bounded snapshot контекста,
  конфигурации и temporal assignments с domain-separated semantic hash без
  передачи keyword IDs/text;
- `platform-seo-data/src/internal` — отдельные `PlatformApiGuard` и
  `JobsApiGuard` для general route groups плюс dedicated rank guards;
- `platform-jobs-integrations/src/email` — email port, disabled и SMTP adapters;
- `platform-realtime/src/realtime` — Socket.IO gateway и Redis adapter;
- `platform-realtime/src/notifications` — профильные правила, membership-bound
  проектные подписки, effective policy, user-scoped notification center и
  encrypted browser Web Push device lifecycle;
- `platform-realtime/src/common/request-id.ts` — bounded correlation ID для
  сквозной Platform API → Realtime трассировки с UUID fallback;
- `platform-realtime/src/internal` — `PlatformApiGuard` general HTTP audience,
  отдельный Web Push guard и проверенный actor/tenant/membership context;
- `platform-web/app` — public, tools, docs и private `/app` App Router screens;
- `platform-web/lib/http-security-policy.ts` + `next.config.ts` — общие
  nosniff/frame/referrer/permissions headers без изменения public marketing
  cache, production HSTS и отдельные private/no-store/noindex rules для
  `/app`; CSP пока ограничен безопасным `frame-ancestors 'none'` без
  непроверенных script/style directives;
- `platform-web/app/app/api` — same-origin browser BFF только к
  `/api/v1` Platform API;
- `platform-web/components/browser-push-settings.tsx`,
  `lib/browser-push.ts`, `lib/push-installation.ts`,
  `lib/push-registration-reconciliation.ts` и
  `public/push-service-worker.js` — явный permission/registration flow,
  IndexedDB installation UUID/schema v2 generation-CAS, causal reconciliation,
  device list/rename/revoke/reconcile, явное recovery повреждённой/future
  local record и Service Worker со scope `/app/` без fetch cache;
- `platform-web/app/app/(protected)/projects/[projectId]/rankings/contexts` —
  private/noindex экран контекстов позиций; UI-компоненты находятся в
  `platform-web/components/tracking-context-*`, provider-free estimate —
  в `rank-estimate-panel.tsx`;
- `platform-web/app/app/(protected)/projects/[projectId]/rankings`,
  `components/rank-history.tsx`, `components/rankings-tabs.tsx` и
  `lib/rank-history.ts` — private/noindex история позиций с UTC range,
  context/keyword filters, cursor-дозагрузкой и явными archived/read-only
  состояниями;
- Web image получает обязательный `WEB_PUBLIC_URL` как
  `NEXT_PUBLIC_SITE_URL` до `next build`, чтобы canonical metadata, robots и
  sitemap не зависели от запоздалого runtime env;
- незавершённый `platform-admin` остаётся только в Compose-сети `internal`,
  без `edge`, host port и browser CORS/WebSocket allowlist. Публичный ingress
  запрещён до отдельной operator auth session/audience, обязательной 2FA,
  platform-role authorization, audit и server-backed non-demo data. Его
  Next policy уже выставляет private/no-store/noindex и строгие security
  headers для любого route;
- `platform-web/lib/protected-app.ts` — server-side session gate и безопасный
  refresh redirect;
- `platform-*/lib` и `components` — adapters и переиспользуемые UI-части;
- `platform-infrastructure/docker` — reusable backend/web images;
- `platform-infrastructure/compose.dokploy.yml` — отдельный internal-only
  `rank-worker` process того же Jobs image с exact env allowlist, bounded
  resources, migration/Redis/SEO Data/Platform API dependencies, двумя
  dedicated rank tokens, forced-disabled provider submit и без
  ports/outbound;
- тот же Compose разделяет Jobs HTTP, Redis-only system, import и inspection
  env allowlists; static regression проверяет exact recipients четырёх
  caller/audience и dedicated service tokens и запрещает legacy env;
- `platform-infrastructure/security/validate-service-tokens.sh` — one-shot
  fail-closed deploy preflight для глобальной проверки всех девяти service
  tokens и `RANK_HISTORY_CURSOR_KEY`; шесть token-bearing processes зависят от
  его успешного завершения;
- тот же Compose fail-closed требует `JOBS_TO_SEO_RANK_RESULT_TOKEN` и
  `RANK_HISTORY_CURSOR_KEY` только для `seo-data`; regression test запрещает
  их случайную выдачу остальным runtime processes;
- `platform-infrastructure/postgres/init` — создание service databases;
- `platform-infrastructure/postgres/roles` — fail-closed cluster bootstrap
  canonical `platform/seo/jobs/realtime` migration-owner и runtime roles,
  SCRAM password provisioning через stdin, безопасная передача только пустых
  legacy databases и cluster-wide ownership/membership/ACL audit;
- `platform-infrastructure/postgres/config/start-postgres.sh` — generated
  first-match HBA для всех canonical owner/runtime, Directus и connector
  logins: SCRAM разрешён только в exact собственной database, replication,
  соседние databases и stale family names отклоняются до общих local/host
  rules;
- `platform-infrastructure/postgres/permissions` — идемпотентные fail-closed
  post-migration grants. `service-runtime.sql` проверяет canonical database/
  schema/object owner, запрещает runtime membership/ownership и выдаёт только
  CRUD без `_prisma_migrations`/`TRUNCATE`, sequence use и точные routines;
  default ACL сохраняют правило для будущих объектов. Отдельный audited
  `seo-extension-runtime.sql` закрывает `PUBLIC` у member functions exact
  `pg_trgm` и открывает их только `seo_runtime`. Connector DDL создаёт/
  ужесточает `jobs_connector`, отклоняет обе стороны membership edge,
  cluster ownership/чужой ACL и выдаёт только exact `EXECUTE` allowlist
  credential-validation broker, rank claim и pre-network authorize. Directus
  имеет документированное combined owner/runtime исключение
  `directus_runtime_owner` только для `directus_db`. Target environment всё
  равно требует проверки фактического HBA order/login smoke, а непустой legacy
  volume — reviewed object-by-object ownership handoff.

Entrypoints:

- API/SEO/realtime/jobs HTTP: `src/main.ts`;
- system worker: `platform-jobs-integrations/src/worker.main.ts`;
- upload inspection worker:
  `platform-jobs-integrations/src/inspection-worker.main.ts`;
- semantic import worker:
  `platform-jobs-integrations/src/import-worker.main.ts`;
- rank manifest preparation worker:
  `platform-jobs-integrations/src/rank-worker.main.ts`;
- credential validation connector worker:
  `platform-jobs-integrations/src/connector-worker.main.ts`;
- connector DB permission init:
  `platform-infrastructure/postgres/permissions/provision-jobs-connector-role.sh`
  + `jobs-connector.sql`, one-shot Compose service
  `jobs-connector-db-permissions`;
- service DB role bootstrap и runtime permission init:
  `platform-infrastructure/postgres/roles/provision-service-database-roles.sh`
  + `platform-infrastructure/postgres/permissions/provision-service-runtime-role.sh`,
  one-shot Compose services `service-database-roles` и
  `*-runtime-db-permissions`;
- Next.js: App Router соответствующего frontend-пакета;
- remote stack: `platform-infrastructure/compose.dokploy.yml`.

## 7. Статус модулей

Легенда: `planned` → `foundation` → `vertical slice` → `production-ready`.

| Модуль | Статус |
|---|---|
| Contracts | foundation |
| Service health/readiness | foundation |
| Prisma schemas | foundation |
| NATS/Redis wiring | foundation |
| S3/email ports | foundation |
| Realtime public gateway | foundation |
| Unified Web/private app shell | vertical slice |
| Admin shell | vertical slice |
| Auth core | vertical slice |
| Workspaces/projects/team access | vertical slice |
| Semantics/import | vertical slice: CSV/TSV → mapping → validation → publish → query |
| Notifications | vertical slice: preferences → effective policy → read center → encrypted browser device lifecycle |
| Integrations | vertical slice: catalog + encrypted BYOK vault + validation + project binding |
| Rankings | vertical slice: contexts + estimate/preparation + persisted/public history; provider execution отсутствует |
| Billing/YooKassa | planned |
| Directus content | planned |

Foundation содержит четыре валидные Prisma schemas и начальные migrations,
health/readiness, Redis/BullMQ, NATS transport, S3/SMTP adapters, fail-closed
WebSocket gateway, unified web/admin shell и Dokploy Compose.

Identity core содержит регистрацию email/password, consent snapshots,
Argon2id, email verification, одноразовое password recovery с отзывом прежних
сессий, TOTP/recovery codes с зашифрованными secrets и короткоживущим login
challenge, короткую access cookie, rotation refresh cookie, CSRF, session
inventory/revocation, PostgreSQL rate limit, audit и outbox. По ADR-2026-036
terminal revoke сериализуется advisory lock по user, меняет distinct whole
families и пишет exact redacted `identity.session-family.revoked.v1`.
Password reset дополнительно инвалидирует outstanding login MFA challenges;
session issue повторно проверяет ожидаемую версию active user под lock.
MFA setup/activation/disable и revoke-others повторно валидируют exact
active/unexpired principal session под тем же lock. Новые family IDs — UUIDv7;
legacy UUIDv4 продолжают читаться без backfill.

Tenant core содержит workspace/project CRUD, системную RBAC-матрицу,
одноразовые workspace invitations, optimistic locking участников и
`project_member_access`. Проектное назначение только сужает workspace role;
`NONE` и отсутствие назначения при `all_projects=false` скрывают проект.

Private Web содержит same-origin BFF, регистрацию/вход/подтверждение email,
запрос и установку нового пароля, refresh/logout, session gate, создание и
выбор workspace/project, MFA challenge и экран безопасности профиля. До
появления SEO-данных dashboard показывает empty states, а не демонстрационные
значения.

Первый import slice содержит публичные project upload endpoints, внутренний
multipart lifecycle в jobs database, прямую browser → S3 загрузку частей,
resume через `sessionStorage`, retry/cancel, обязательную проверку полного
набора частей и фактического размера. `upload.completed.v1` означает только
статус `UPLOADED`; использовать объект для импорта можно лишь после inspection
worker и статуса `READY`.

Inspection worker читает S3 строго потоком, удерживает восстанавливаемый
lease/heartbeat, считает фактический SHA-256 и размер, проверяет сигнатуру
контейнера/MIME и передаёт весь поток в ClamAV. Scanner работает fail-closed:
его недоступность возвращает запись в `UPLOADED` для retry, а не разрешает
импорт. Итог фиксируется событиями `upload.ready.v1` или
`upload.rejected.v1`; rejected-объект не получает download/import access.
Web после multipart completion опрашивает project-scoped status endpoint,
показывает scanning/ready/rejected и позволяет отдельно обновить долгую
проверку, не создавая повторную загрузку.

Второй import slice создаёт import только из `READY` upload, повторяет команду
по `Idempotency-Key` и ставит в отдельную BullMQ queue только `importId`.
Import worker потоково определяет UTF-8/Windows-1251 и разделитель, корректно
обрабатывает quoted/multiline CSV/TSV, восстанавливает зависший lease,
сохраняет исходные значения в 16 hash partitions и предлагает mapping
типовых колонок Key Collector. Jobs API не возвращает raw staging наружу.
Web автоматически запускает CSV/TSV parsing после inspection, показывает
progress и ограниченный preview колонок/строк. Публикация в канонический
semantic core выполняется только после отдельного подтверждения пользователя.

Третий import slice сохраняет подтверждённые язык, separator групп, mapping и
merge policy, затем создаёт отдельный validated staging. Нормализация и поиск
существующих запросов выполняются владельцем `seo_db`; неизвестные показатели,
позиции без tracking context и исходные raw values не теряются. UI показывает
summary дублей, ошибок и готовых уникальных запросов до необратимой публикации.

Publisher передаёт не более 500 уникальных строк на command, повторно
валидируемую `seo-data`. Receipt с mapping/payload hash делает begin/chunk/
complete идемпотентными, project advisory lock сериализует merge, а complete
создаёт semantic version и outbox event. Отмена во время публикации завершает
текущий chunk и фиксирует partial version; зависший `cancel_requested`
подбирается dispatcher-ом. Jobs не имеет подключения к `seo_db`.

Опубликованное ядро читается по `GET /api/v1/projects/:projectId/keywords`.
Platform API проверяет session, `semantic.view` и tenant scope, затем вызывает
internal query `seo-data`; Web использует только same-origin BFF. Список
применяет keyset cursor по `created_at DESC, id DESC`, до 200 строк, связанный
с поиском opaque cursor и GIN/trigram индекс. Exact count выполняется только
на первой странице. UI содержит поиск, дозагрузку, loading/empty/error states
и автоматически обновляется после полной или частичной публикации версии.

Настройки уведомлений читаются и изменяются только через Platform API:
`/api/v1/me/notification-preferences` и
`/api/v1/projects/:projectId/notification-subscription`. Профиль задаёт
master-switch каналов, timezone, quiet hours, digest schedule и матрицу
категорий. Проект может наследовать профиль, переопределить только разрешённые
каналы либо временно поставить доставку на паузу. Подписка привязана к
`workspace_members.id + version`; отзыв или новая версия членства не
активирует старые правила. Web Push permission запрашивается только явной
кнопкой.

Browser devices читаются и изменяются через
`GET/PUT/PATCH/DELETE /api/v1/me/push-subscriptions`; публичный body не задаёт
actor/session/status. Platform API инжектирует проверенную session family и
использует отдельный `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`.
Installation UUID хранится Web в IndexedDB. Realtime принимает только exact
HTTPS endpoint origins, шифрует endpoint/keys через versioned AES-256-GCM,
использует независимый HMAC keyring для fingerprints, ограничивает active
devices (default 20), возвращает active devices перед bounded tombstone
history, очищает due subscriptions до list/upsert и стирает secret material
при terminal revoke/expiry. Межсервисный request ID принимается только в
bounded safe ASCII-формате, иначе заменяется локальным UUID. Partial unique
index защищает один HMAC digest; межверсионная endpoint uniqueness требует
all-keyring lookup и rollout `expand на всех replicas → drain → switch`.
VAPID public key имеет immutable version; private key не поступает в HTTP/Web
process. Service Worker работает в scope `/app/`, не содержит fetch handler и
не кэширует private API. Локальная schema v2 хранит
`reconcileGeneration/reconciledGeneration`: Service Worker и вкладки
атомарно повышают generation, а успешный PUT очищает marker только для exact
generation и только если отправленная subscription всё ещё совпадает с
browser state. Запоздалый PUT после локальной смены subscription повторно
взводит marker. Повреждённая или future local record восстанавливается лишь
после явного подтверждения, успешного browser unsubscribe и выдачи нового
installation UUID; перенос между аккаунтами запрещён. Registration честно
возвращает
`deliveryAvailable=false` и `testDeliveryAvailable=false`: email/Web Push
sender, digest и delivery history пока отсутствуют.

Dependency-free handler `identity.session-family.revoked.v1` атомарно
сохраняет versioned inbox scope, durable tombstone и отзывает только active
devices той же `userId + sessionFamilyId`, уничтожая crypto/fingerprint
material. Второй event ID той же family идемпотентен, а reuse event ID для
другого scope отклоняется. Device upsert проверяет tombstone сразу после
общего user lock и до endpoint lock либо mutation; Platform API сохраняет
terminal `401 UNAUTHENTICATED`, не маскируя его как сбой зависимости. DDL
добавляет индекс `user + registered session family + status`. Сам handler
ещё не подписан на JetStream, поэтому producer outbox пока не доставляет
событие автоматически.

Центр уведомлений доступен по `/app/notifications`; колокольчик получает
user-scoped unread count, а список использует keyset cursor
`created_at DESC, id DESC`, связанный с фильтром `unreadOnly`. Публичные
`GET /api/v1/notifications`, `PATCH /:id/read` и `POST /read-all` проходят
только через Platform API. Realtime DB хранит явные event type, severity,
project/resource references и только локальный `/app` deep link; произвольный
JSON наружу не возвращается. Mark-read команды идемпотентны и ограничены
текущим пользователем.

Workspace API-ключи управляются через `/app/settings/integrations`. Platform
API проверяет workspace permission и передаёт trusted actor/workspace context
в jobs/integrations. Секрет и XMLStock user ID шифруются одним authenticated
payload под случайным per-record DEK; versioned KEK шифрует DEK. AAD связывает
payload с workspace/provider/credential ID, а обёрнутый DEK — ещё и с KEK
version. Секрет не возвращается после сохранения и не попадает в
audit/queue/event. Карточки честно показывают `PENDING_VERIFICATION`:
credential нельзя использовать до реального provider-specific test.
Пользовательский base URL не поддерживается. Create требует
`Idempotency-Key`: workspace-wide unique key и keyed fingerprint дают
существующий credential для точного повтора и conflict для другого
actor/payload. Fingerprint version не связан с KEK version, поэтому lifecycle
идемпотентности не блокирует будущий DEK rewrap. UUID канонизируются до
lowercase до AAD/fingerprint и не меняются после PostgreSQL round-trip.

`POST .../credentials/{id}/validations` требует `integration.test`, recent
authentication, CSRF и `Idempotency-Key`; `GET .../validations/{validationId}`
требует `integration.view` и остаётся доступным в billing read-only режиме.
Credential list присоединяет только одну active validation текущего
`material_version`; partial unique делает batch bounded. Поэтому после
reload/navigation другой участник видит текущую job, а Web продолжает GET
polling без повторного POST. Если job появилась между list и POST, `409`
обрабатывается повторным чтением authoritative list и присоединением к ней;
terminal history в credential list не загружается.
Receipt точного повтора ищется до чтения изменяемого credential state:
rotate/disable/revoke не меняют результат уже принятой job-команды, а
`material_version` остаётся execution snapshot и active dedup boundary.
PostgreSQL является источником истины для статусов, attempt, lease и
`retryAt`; dispatcher восстанавливает потерянные сообщения BullMQ, а его
lease/retry indexes начинаются с `job.type`. В очередь не попадает секрет.
Execution worker расшифровывает его только в памяти и вызывает фиксированные
HTTPS endpoints Arsenkin или Keys.so с timeout, запретом redirect, строгим
JSON для `2xx`, body limit 1 MiB и нормализацией ошибок.
Успешная provider validation заменяет сохранённый capability snapshot
текущим allowlist каталога: удалённая capability исчезает сразу через
пересечение, а новая не выдаётся старому ключу без повторной внешней проверки.
Terminal update атомарно сверяет workspace и `material_version`: замена или
revoke credential делает старую проверку `STALE`, не перезаписывая новый
материал. Retry учитывает ограниченный `Retry-After`. XMLStock остаётся
`PROVIDER_DOCUMENTATION_REQUIRED`, поэтому его проверка честно недоступна.
Partial unique active dedup key ограничивает один validation на пару
credential/material даже при разных `Idempotency-Key`.

Проектные источники настраиваются через
`/app/projects/:projectId/settings/integrations`. Первый честный UI-срез
показывает только `SERP_RANK_TRACKING`; общий contract остаётся
capability-based. На пару `workspace + project + capability` существует одна
привязка и один нормализованный route `WORKSPACE_CREDENTIAL` с `position=0`.
Создание разрешает только non-deleted `ACTIVE BYOK_API_KEY`, принадлежащий
workspace и поддерживающий capability одновременно в сохранённом credential и
текущем provider catalog. Отключить уже сломанную привязку можно без активного
ключа; включение и смена route повторяют строгую проверку.

POST требует `Idempotency-Key`: binding, route, immutable create receipt с
32-byte request hash/исходным response snapshot и redacted outbox event
создаются одной транзакцией. Поэтому replay после PATCH возвращает исходный
ответ создания. PATCH требует `If-Match`, использует CAS и при гонке отвечает
`412 VERSION_CONFLICT` с безопасным `currentVersion`. Billing `READ_ONLY` и
архивный проект сохраняют просмотр, но не разрешают новые изменения; проекты
и bindings автоматически не удаляются. Platform keys, fallback и budgets
пока возвращают `FEATURE_NOT_AVAILABLE`, а credential options не содержат
секрет, masked hint или provider metadata.
Aggregate читается одним `RepeatableRead` snapshot и возвращает не более 500
options; при большем vault выставляет `credentialOptionsTruncated`, сохраняя
в выдаче credentials уже назначенных bindings. Create/enable/swap держат
tenant-scoped `FOR SHARE` lock credential до commit, поэтому rotate/revoke не
может пройти между проверкой и записью binding. Outbox payload типизирован в
`platform-contracts`, не содержит credential ID и передаёт безопасный
`changedFields`, включая смену route между двумя ключами одного provider.

Контексты позиций настраиваются на
`/app/projects/:projectId/rankings/contexts`. Public API
`/api/v1/projects/:projectId/tracking-contexts` поддерживает list/create/get/
update/archive/restore и point PUT/DELETE assignments; внутренний mirror
принадлежит SEO Data. Read требует `ranking.view`, mutation —
`ranking.configure`, CSRF и mutable project/workspace. Create использует
immutable idempotency receipt, update/archive/restore — `If-Match`; billing
read-only и архивный проект не скрывают чтение. Списки bounded: 200 contexts
с `contextsTruncated`, assignments — keyset cursor с limit до 200.

`seo_db` migration `20260729130000_versioned_tracking_contexts` добавила
`tracking_context_versions`, `tracking_context_keyword_assignments` и
`tracking_context_create_receipts`, а `tracking_contexts` оставила logical
entity с OCC/archive state. Поисковые изменения создают immutable
configuration version; rename/archive/restore её не переписывают. Assignment
закрывается `removed_at`, повторное назначение создаёт новый период,
`keywords.is_tracked` больше не источник истины. Migration блокирует legacy
tracking/rank tables `ACCESS EXCLUSIVE` и fail-closed останавливается при
наличии данных.

Contracts содержат HTTP DTO и события
`seo.tracking-context.created/updated/archived/restored.v1` и
`seo.tracking-context.keyword-assignment.changed.v1`. SEO Data пишет их в
outbox атомарно и без name, keyword text, URL, provider/credential/schedule и
raw configuration. Durable outbox publisher всё ещё не реализован, поэтому
эти записи ещё не доставляются через NATS.

Provider-free estimate доступен через
`POST /api/v1/projects/:projectId/rank-estimates` с телом только
`trackingContextId`. Platform API требует session, CSRF, `ranking.view` и
`Idempotency-Key`, но намеренно не требует `ACTIVE` lifecycle для успешного
ответа: read-only, архив, отсутствие `ranking.run`, entitlement/quota и
состояние connector возвращаются finite blockers. Jobs-owned internal
resource использует
dedicated caller token, stable-intent request hash и immutable public/private
snapshot. SEO Data возвращает exact count до 1 000 либо sentinel `1001`,
а для provider-incompatible bounded scope 1..1 000 либо overflow `1001`
возвращает согласованные unavailable semantic/final hashes. Пустой scope
всегда materializable. TTL receipt — пять минут;
replay после drift project/access/quota возвращает исходный ответ. Пока
обязательны `PROVIDER_CONTRACT_NOT_READY` и
`PROVIDER_EXECUTION_DISABLED`, ни provider call, ни Job/BullMQ, ни usage,
reservation, outbox/event не создаются.

Secret-bearing rank manifest endpoints принадлежат SEO Data и защищены
отдельным `JOBS_TO_SEO_RANK_TOKEN`; general caller/audience tokens не дают
читать keyword text chunks. Secret получает только SEO Data validator и
отдельный rank-worker Jobs; generic HTTP, connector/import/inspection/system
workers secret не получают. Клиент запрещает HTTP redirects, ограничивает
размер ответа и принимает только exact tenant-bound receipt.

Execution contract foundation принимает в public create только `estimateId`
и возвращает Job через конечную discriminated lifecycle матрицу. SEO Data
manifest runtime уже реализует dedicated-auth seal/chunk endpoints,
`RepeatableRead` snapshot, byte-first limits, immutable
`BUILDING → SEALED → CLOSED`, provenance checks и partial unique active
semantic dedup. Shared allowlist preimage builders и golden vectors
синхронизируют producer/verifier; full hash включает `sealedBy`, semantic hash
не меняется от clone/rename tracking context, display label, metadata или
remove/reassign, если provider-effective work остаётся тем же. Interactive
manifest transaction использует явные `maxWait=5s` и `timeout=30s`.

Jobs `PREPARING`/JobItem preparation runtime и cancellation finalize
реализованы. PostgreSQL хранит exact command до HTTP, BullMQ получает только
`jobId`, bounded producer не удерживает HTTP при недоступном Redis, а
dispatcher восстанавливает потерянные notifications. Перед HTTP exact
command сверяется с immutable Job/Run/Estimate graph. DB triggers защищают
initial state, monotonic version/attempt, receipts, cancel audit и committed
Job/Run/Estimate coherence. Create вставляет Job, затем sidecar; все мутации
существующего graph блокируют `Job → RankJobRun`. Единственный разрешённый
version drift принимает cancel между seal request/response. Заведомо не
созданный manifest становится `NOT_SEALED`; retryable transport ambiguity
повторяет exact idempotent command в пределах 20 attempts, а non-retryable
неоднозначность либо исчерпание budget дают terminal
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`.

Normalized chunk ingest, append-only snapshots, monotonic current projection,
успешный/partial finalize и atomic redacted completion outbox реализованы в
SEO Data с одним manifest lock и запретом late ingest. Internal history
использует tenant/filter-bound HMAC cursor. Public Platform API строго
валидирует scope, диапазон, фильтры, порядок, дубликаты и cursor coherence,
redact-ит ответ SEO Data и отдаёт collection envelope. Private/noindex Web
экран использует bounded UTC range, optional context/keyword filters и
load-more. Platform API execution-grant issuer foundation реализован, но
production policy выдаёт только persisted `DENIED`, пока отсутствует
authoritative entitlement/quota implementation. Jobs bounded client и durable
grant intent/decision history реализованы как fail-closed foundation: network intent
записывается первым, exact replay сохраняется, а неистёкшее положительное
решение атомарно связывается с secret-free scoped connector execution и
становится `CONSUMED`. SECURITY DEFINER claim, scoped encrypted credential
projection и exact connector permissions реализованы; `CLAIMED` остаётся
pre-network. Authorize повторно проверяет весь current graph и атомарно
фиксирует `SUBMITTING`/single-attempt marker до secret-free permit. Runtime
caller, connector submission/status и normalized result producer ещё не
реализованы, поэтому production worker не создаёт provider snapshots.

## 8. Проверенное состояние

- Prisma Client generation: pass для 4 сервисов.
- Prisma schema validation: pass для 4 сервисов.
- TypeScript strict typecheck: pass для 8 пакетов.
- Platform API tests: 273 pass, 0 fail, 3 opt-in PostgreSQL 18 tests skipped
  без отдельного disposable database URL.
- SEO data unit tests: 89 pass, 0 fail.
- Jobs/integrations tests: 271 pass, 0 fail, 6 disposable-DB tests skipped
  в обычном запуске; startup decrypt-canary targeted suite — 7/7 pass.
- Realtime unit tests: 50 pass, 0 fail.
- Contracts unit tests: 64 pass, 0 fail.
- Unified Web helper tests: 101 pass, 0 fail.
- Infrastructure DB-role/connector и затронутый rank dependency targeted
  scope: 9 pass, 0 fail; PostgreSQL regressions остаются opt-in в обычном
  запуске.
- Отдельный fresh PostgreSQL 18 service-role proof: pass; применены 37 Prisma
  migrations четырёх сервисов, подтверждены runtime CRUD/UUIDv7/constraints,
  запреты DDL/`_prisma_migrations`/`TRUNCATE`/membership/ownership/
  cross-database/replication/`PUBLIC` bypass, Directus exception, exact
  connector grants и реальный first-match HBA login/reject.
- Полный root `pnpm test` после startup-canary и scoped claim: pass без
  failures; обычный запуск безопасно пропускает opt-in disposable-DB tests.
  Отдельный fresh PostgreSQL 18 gate для Jobs grant/claim: 4/4 pass.
- Root lint: pass на pinned Oxlint 1.76.0 с Import, React, Promise и Node
  plugins и `--deny-warnings`.
- NestJS production build: pass для 4 сервисов.
- Next.js production builds: pass для Web и Admin; в Web проверены public
  site, Toolbox, API docs и private `/app`.
- Compose config: предыдущий baseline pass с `.env.example` и ephemeral
  overrides для намеренно пустых dedicated token examples. Текущая grant-token
  проводка защищена static scope tests; повторный render недоступен без Docker
  на этом хосте и остаётся CI/staging gate.
- Предшествующие Jobs migrations и connector column grants: pass на локальном
  PostgreSQL 16; отдельно проверены запреты `INSERT`, ciphertext/outbox
  access, ownership и `BYPASSRLS`. Полная цепочка из 13 Jobs migrations,
  включая `rank_estimates`, `ACTION_REQUIRED` и `rank_job_runs`, повторно
  применена fresh на PostgreSQL 15 с test-only `uuidv7()` shim; целевой
  PostgreSQL 18 повторяется в staging.
- Resolved Compose topology: outbound-required Jobs runtimes имеют
  `internal,outbound`; connector не публикует ports и не получает
  management/NATS credentials.
- Rank-worker Dokploy topology: 3/3 static tests и Compose config pass;
  process использует только `internal`, 16 allowlisted env keys, отдельные
  manifest/grant rank tokens, принудительный disabled submit и не получает
  ports/outbound/NATS/S3/SMTP/vault credentials.
- Visual QA: 1440, 1024 и 390 px; horizontal overflow не найден.
- Semantics upload browser QA: 1280 px, runtime errors и horizontal overflow
  не найдены; устранён CSS conflict публичного `.brand` с app shell.
- Mapping/publish wizard browser QA: реальный multipart flow через mock S3/API,
  1440 и 390 px; document overflow и browser errors не найдены, таблица
  прокручивается только внутри своего контейнера, singleton mapping и
  обязательный separator проверены интерактивно.
- Notification preferences browser QA: profile/project screens на 1280 px,
  а также mobile recheck на 390 px; document overflow и browser errors не
  найдены, минимальный текст 11 px; override, live effective preview, pause и
  успешный optimistic save проверены интерактивно.
- Notification center browser QA: 1280 px, document overflow и browser errors
  не найдены; unread badge, одиночное чтение, unread filter, read-all и empty
  state проверены интерактивно.
- Browser Web Push Web: strict typecheck, 78/78 tests, production build и
  diff-check — pass. Покрыты IndexedDB v1→v2 migration, multi-tab/Service
  Worker generation-CAS, delayed stale PUT re-arm, exact subscription match,
  corrupt/future record recovery, strict payload/deep-link validation и
  same-origin BFF body limits. Protected visual/e2e с живыми API и browser
  permission остаётся staging gate.
- Integration settings browser QA: 1440 и 390 px, document overflow и browser
  errors не найдены; таблица/табы прокручиваются только внутри контейнеров,
  XMLStock full-secret replacement проверен интерактивно.
- Project connector settings: production build и same-origin BFF smoke pass;
  отдельно проверены cross-workspace deep link, reconnect race, immutable
  create replay, `412/409`, bounded options и mobile overflow. Интерактивный
  browser backend в текущем окружении недоступен, поэтому новый экран требует
  повторного visual smoke после удалённого deploy.
- Tracking context SEO Data: Prisma validate/generate, strict typecheck,
  production build pass. Fresh full SEO migration chain применён на локальном
  PostgreSQL 15; fail-closed/concurrent-writer сценарии и повтор на целевом
  PostgreSQL 18 остаются staging gates.
- Tracking context Platform API: strict typecheck, 116 unit tests, production
  build и diff-check pass. Compiled bootstrap зарегистрировал новые modules и
  routes без DI errors; startup остановился только на ожидаемо недоступном
  тестовом NATS.
- Tracking context Web: strict typecheck, 44 helper/BFF tests, production
  build и diff-check pass; private/noindex route входит в build. BFF PUT и
  client helpers покрыты тестами. Защищённый browser visual/e2e не запускался
  без live auth/API и остаётся обязательным после удалённого deploy.
- Provider-free rank estimate: Contracts 9/9, SEO Data 28/28, Platform API
  128/128, Jobs/integrations 159/159 и Web 54/54 tests; strict typecheck,
  production build и diff-check проходят. Проверены exact replay после
  mutable snapshot drift, concurrent winner, bounded SEO response,
  credential projection без secret columns, finite blockers, 1001 sentinel,
  TTL и redaction. Живой PostgreSQL 18 migration smoke и защищённый visual/e2e
  остаются staging gates.
- Manual rank execution contracts: 12/12 targeted tests, strict typecheck,
  production build и diff-check — pass. Review findings по nullable estimate
  hash matrix, provenance, TOAST preflight, semantic dedup и full sealedBy
  integrity устранены; проверены finite lifecycle/status, public redaction,
  canonical ingest provenance, finalize/late-ingest ordering и terminal
  count invariants.
- Immutable rank manifest SEO Data: Prisma validate/generate, strict
  typecheck, 51/51 tests, production build и diff-check — pass. Fresh
  migrations и state/provenance/active-dedup negative smoke прошли на
  PostgreSQL 15; target PostgreSQL 18 остаётся release gate.
- Durable rank preparation Jobs: Prisma validate/generate, strict
  typecheck, 213/213 executable tests, production build и diff-check — pass;
  обычный suite дополнительно содержит два skipped disposable-DB tests.
  Fresh 13-migration deploy, реальные lifecycle/immutable negative checks и
  `Job → RankJobRun` concurrent lock-order test прошли на PostgreSQL 15 с
  test-only `uuidv7()` shim.
  Node.js 24 и PostgreSQL 18 остаются staging gates. Live provider submit,
  ingest и completion event в этот срез не входят.
- Platform API execution-grant issuer: Contracts 11/11, Platform API 59 pass
  и 3 opt-in PostgreSQL 18 tests skipped, infrastructure scope 2/2; Prisma
  validate/generate, strict typecheck, lint, production build и diff-check —
  pass. Review findings по usable TTL, early-error `no-store`, exact expired
  replay, reservation coherence и production secret scope устранены.
- Jobs grant intent/consume foundation: bounded client/config/lock/evidence/
  state unit, secret-free connector execution и static migration coverage
  добавлены. Prisma validate/generate, strict typecheck, 271 executable tests,
  lint, production build и diff-check — pass; обычный suite дополнительно
  содержит два skipped disposable-DB tests. Fresh full migration chain,
  claim-specific concurrent claim/reclaim, stale-head, cancel, credential и
  immutable kill-switch regression прошли на PostgreSQL 18. Остальные
  negative/race smoke migrations
  `20260729230100_rank_execution_grant_attempts` и
  `20260729230200_rank_connector_executions` учитываются отдельным gate.
- Shared canonical JSON: official RFC 8785 primitive/key-order/UTF-8 vectors,
  hostile values/accessors/cycles/Proxy fail-closed; server-only subpath
  resolution из SEO Data проверен. Production dependencies не добавлялись.
- Identity session-family producer: Contracts 16/16 и Platform API 175/175
  tests, strict typecheck/build/diff-check, Prisma validate/generate — pass.
  Проверены exact redacted payload, whole-family/idempotent revoke, чужая
  session, stale principal/version, refresh reuse/expiry commit-before-401,
  reset и MFA ordering. Реальные PostgreSQL 18 race/outbox rollback tests
  остаются staging gate; Prisma schema/migration в этом срезе не менялись.
- Realtime revoked-family application handler: Prisma validate/generate,
  strict typecheck, 47/47 tests, production build и diff-check — pass.
  Покрыты оба порядка event/registration, exact duplicate, второй event ID,
  scope collision, rollback и сохранение валидного delivery snapshot.
  Platform API targeted mapping tests 8/8 и typecheck — pass. Fresh migration
  и реальные concurrent transactions остаются PostgreSQL 18 staging gate;
  JetStream publisher/subscription в этот dependency-free срез не входят.
- HTTP response security policy: Platform API 278 executable tests pass и 3
  opt-in PostgreSQL tests skipped, Web 105/105, Admin 2/2; strict typecheck,
  root lint и production builds всех трёх packages — pass. Fastify injection
  покрывает private override/Vary merge, parser/guard/404/internal paths и
  proxy-aware HSTS. Next production manifests подтверждают общие security
  headers, отдельный `/app`/Admin private-noindex policy и отсутствие
  public marketing cache override. Full script/style CSP и HTTPS smoke через
  фактический production proxy остаются release gates.
- Target runtime: Node.js 24. Текущий полный lint/typecheck/test/build baseline
  проверен на Node.js 24.18.1; контейнеры также используют Node.js 24.

## 9. Следующий вертикальный срез

`durable provider request intent/runtime → submit/status/fetch persistence →
normalized result producer/ingest receipts`

Provider-free estimate и SEO Data immutable manifest из ADR-2026-034
завершены; durable Jobs `PREPARING` saga, exact seal recovery, cooperative
cancel, public/Web Job lifecycle и normalized SEO Data result persistence
также готовы. Public bounded history proxy и private/noindex Web UI уже
подключены к internal read model. Authoritative one-time grant уже имеет
Platform-owned issuer/receipt, Jobs-owned intent/decision и атомарный
`CONSUMED ↔ rank_connector_executions/READY_TO_SUBMIT`. Scoped broker/claim,
exact connector permission и атомарный authorize/`SUBMITTING` уже готовы и
прошли fresh PostgreSQL 18 permission/race/upgrade proof. Следующим нужны
immutable exact request intent до grant, runtime caller, durable provider
submit/status/fetch state и producer нормализованных результатов с ingest
receipts. Live Arsenkin `set` выключен, пока нет recorded provider contract,
полного persisted provider lifecycle, fairness/circuit breaker и production
environment evidence.
Неоднозначность manifest preparation уже fail-closed переходит в
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` без бесконечного auto-retry.

Параллельный обязательный следующий срез уведомлений:
`profile/project effective policy → transactional outbox/durable consumer →
email + Web Push delivery`. Browser device/VAPID public-key lifecycle уже
реализован по ADR-2026-035; следующий срез добавляет durable session-family
event publisher и transport subscription к уже готовому Realtime handler
(producer, tombstone и fail-closed device-upsert check реализованы по
ADR-2026-036), VAPID private-key sender, идемпотентные delivery attempts,
retry/DLQ, digest и delivery history. Production-зависимости
`@nats-io/jetstream` и `web-push` ещё не одобрены, а фактическая
durable-доставка не реализована. OAuth/OIDC выполняется после подтверждения
зависимости `jose`; QR для TOTP — после подтверждения `qrcode`.

## 10. Незавершённые риски

- Дашборд использует честные empty states до первого rank data slice.
- Realtime не допускает вход в project rooms до общей token/permission проверки.
- Миграция backfill-ит `keyword_groups.path/path_hash` для корректного
  корневого дерева; orphan/cyclic legacy groups перед production требуют
  отдельного data-quality audit.
- `semantic_import_receipts` без chunks требуют bounded reconciliation/retention;
  receipt с применёнными chunks автоматически не удаляется.
- Durable outbox/inbox publisher и consumers ещё не реализованы.
- `rank_estimates` требуют bounded maintenance/retention после окна
  идемпотентных повторов и диагностики; expiry пока только запрещает считать
  receipt актуальным и сам не удаляет строку.
- `rank_snapshots` первого normalized slice пока не partitioned. До реальной
  нагрузки обязательны RANGE partitioning, partition maintenance/retention и
  representative history load test. Public history proxy/UI уже доступны,
  но не заменяют эти storage/load release gates.
- Notification preferences не создают deliveries сами по себе: отсутствуют
  transactional outbox/durable consumer, email/Web Push adapters, digest
  scheduler, VAPID private-key sender и provider delivery history. Device
  lifecycle, identity producer, Realtime tombstone handler и fail-closed
  device-upsert check готовы, но durable outbox publisher/JetStream
  subscription и bounded global provider-expiry sweeper остаются release
  blocker перед внешней доставкой.
  До sweeper due subscriptions безопасно очищаются в user-scoped list/upsert.
- Identity terminal lifecycle ещё требует PostgreSQL 18 staging race tests
  `rotate ↔ rotate`, `login ↔ password reset`,
  `MFA challenge/confirm/disable ↔ reset`, outbox rollback, future
  suspend/deactivate producer и bounded global
  refresh-session expiry sweeper.
- `web_push_subscriptions` migration требует fresh apply и constraint-negative
  smoke на PostgreSQL 18 staging; VAPID/encryption/fingerprint key rollout
  требует expand-first coverage review. Startup guard видит только номера
  versions, но не неизменность key bytes: persistent authenticated canary для
  AES/HMAC keyrings обязателен до production-регистрации. Same-version key
  replacement запрещён. Delivery/test остаются выключены.
- Для rejected/quarantine objects ещё требуется production lifecycle policy и
  отдельный reconciliation/cleanup job; выдача и импорт таких объектов
  запрещены уже сейчас.
- Partitioned import staging требует retention/cleanup job и метрик роста до
  production; raw rows не считаются бессрочной историей.
- CSV/TSV включены; XLSX/ZIP требуют подтверждения production-зависимостей
  `exceljs`/`unzipper`, а legacy XLS — изолированного LibreOffice worker с
  отдельными CPU/RAM/time limits.
- ClamAV требует отдельного memory/capacity budget на VPS; concurrency
  inspection worker ограничивается независимо от API.
- Bucket требует внешней CORS/lifecycle настройки: Web origin, exposed `ETag`,
  abort incomplete multipart через 2 дня.
- Нет production observability и проверенного backup/restore runbook.
- KEK rotation runbook описан в `platform-infrastructure/README.md`, но
  автоматический bounded DEK rewrap ещё не реализован. DB-aware startup
  coverage работает fail-closed; до rewrap старые используемые KEK запрещено
  удалять. Fingerprint keyring ротируется независимо; bounded-инвалидация
  старых fingerprints после retry window также ещё не реализована.
- Номерная coverage дополнена persistent authenticated canary для равенства
  key material. `MANAGEMENT` expand-only регистрирует immutable synthetic
  envelope каждой configured KEK version; `EXECUTION` передаёт broker все свои
  configured versions (не более 128), а получает их объединение с versions,
  реально используемыми неудалёнными credentials, и явный usage marker.
  Поэтому новый ещё не active KEK проверяется на каждой replica до
  переключения, used-but-unconfigured version останавливает startup, а retired
  unused historical canary больше не требует сохранения ключа. Missing canary
  остаётся nullable строкой и вместе с corrupt/wrong-key envelope блокирует
  создание BullMQ worker. Canary не содержит tenant credential data; пустой
  vault допустим. Validation worker оставляет credential без изменений и
  делает job-only bounded retry при любом последующем decrypt failure, поэтому
  mismatch не превращается в массовый `DISABLED`. Cluster-wide circuit
  breaker/incident alert после startup ещё отсутствуют. Rollout: expand
  keyring → canary verify configured ∪ used versions → drain старых replicas →
  switch active.
- `MANAGEMENT` и `EXECUTION` процессы пока получают один symmetric KEK.
  Role guard запрещает штатный decrypt в management adapter, но не даёт
  криптографической изоляции при компрометации процесса; целевая граница —
  KMS/asymmetric wrapping или отдельный credential broker.
- Summary-list credentials пока без cursor pagination и tenant hard limit;
  перед массовыми provider pools нужен bounded endpoint, хотя ciphertext и
  wrapped DEK уже исключены Prisma `select`.
- Foundation DDL migration vault обёрнута в явную транзакцию, а предшествующая
  enum migration намеренно применяется отдельным committed шагом; все
  проверены `prisma validate`. Vault и credential-validation migrations,
  включая CHECK/partial UNIQUE/CAS, успешно применены на локальном
  PostgreSQL 16; повторная staging-проверка на целевом PostgreSQL 18 остаётся
  обязательной.
- Project binding migration также выполняется одной транзакцией и fail-closed
  останавливается при непустой pre-release `integration_bindings`; для такого
  окружения нужен expand → backfill → validate → contract план. Fresh и
  fail-closed сценарии проверены на PostgreSQL 16. Перед precondition таблица
  блокируется `ACCESS EXCLUSIVE`, и concurrent-writer smoke подтвердил
  отсутствие окна check → DROP; PostgreSQL 18 остаётся staging-gate.
- Versioned tracking context migration fail-closed требует пустые
  pre-release `tracking_contexts`, `rank_snapshots` и `current_ranks`, удерживая
  их `ACCESS EXCLUSIVE` от проверки до destructive contract step. SQL,
  constraints и migration-order проверены тестами; fresh apply прошёл в
  полном SEO migration chain на PostgreSQL 15. Fail-closed/concurrent-writer
  сценарии и PostgreSQL 18 остаются staging-gate.
- Rank manifest migration fresh apply и negative lifecycle/provenance/
  active-dedup smoke прошли на PostgreSQL 15. PostgreSQL 18, реальная
  concurrent transaction гонка и rollback/failure injection обязательны до
  release.
- `rank_estimates`/rank preparation migrations согласованы с Prisma,
  fail-closed проверяют legacy manual rows и active dedup conflicts и прошли
  fresh/constraint-negative smoke на PostgreSQL 15. Обычный rebuild unique
  index требует worker drain/maintenance window; для большой live-БД нужен
  expand/concurrent-index план. PostgreSQL 18 smoke обязателен до deploy.
- `rank_execution_grant_receipts` прошли fresh migration и opt-in
  quota/TTL/immutability, concurrent exact winner и lifecycle race smoke на
  PostgreSQL 18. В обычном suite без отдельного disposable
  `PLATFORM_API_RANK_GRANT_TEST_DATABASE_URL` эти тесты безопасно пропускаются.
- `rank_execution_grant_attempts`, `rank_connector_executions`, claim и split
  `SUBMITTING`/authorize migrations прошли fresh full-chain apply на
  PostgreSQL 18. Grant/consume, claim/reclaim/stale-head/drift, authorize/
  replay/rollback/expiry, upgrade ACL и exact non-owner permission regressions
  пройдены. Fresh cluster service-role provisioning/audit также пройден;
  target-environment HBA order/login smoke остаётся deploy gate.
- Issuer receipt и Jobs-owned `CONSUMED/READY_TO_SUBMIT` сами не авторизуют
  provider call. Claim создаёт bounded pre-network lease, а authorize только
  после full Job/cancel/credential/grant/control/fence recheck commit-ит
  `SUBMITTING` marker. Отправлять bytes до этой commit-точки запрещено; после
  неё crash/ambiguity никогда не разрешают автоматический resubmit. Runtime
  caller и дальнейшие durable provider states пока отсутствуют.
- Проверка lifecycle проекта сейчас авторитетна в Platform API, но между ней и
  commit в jobs database остаётся межсервисное TOCTOU. До первого исполняемого
  rank job jobs/integrations обязан получить project/workspace lifecycle
  projection либо другую authoritative precondition, а execution всегда
  повторно проверяет lifecycle/billing.
- Terminal credential validation пока не создаёт transactional outbox event:
  email/Web Push и полный durable audit результата требуют отдельного
  redacted события.
- Credential validation имеет global BullMQ limiter и DB-enforced
  per-credential/material single-active cap, но ещё не имеет server-side
  per-workspace/provider quota и справедливого планирования между tenants.
- Connector worker использует отдельный PostgreSQL login без direct table
  DML; exact `SECURITY DEFINER` allowlist выдаёт только due IDs, одну
  lease-bound encrypted projection и fenced finish. Claim держит credential
  lock до свежих DB clock/token, возвращает `leaseExpiresAt`, а worker требует
  запас lease не меньше provider timeout + 2 секунды; Arsenkin success metadata
  проходит exact DB invariant. Fresh PG18 non-owner/lock-wait tests доказали
  direct/Public denial, concurrency/reclaim/stale/material/pg_temp invariants.
  Отдельный fresh 19-migration provisioning proof подтвердил SCRAM, обе стороны
  membership fail-closed, cluster/current-schema ACL audits, отсутствие DML/
  PUBLIC/management access и точный claim/authorize allowlist. Generated HBA
  и fixed-role PG18 harness закрывают cross-DB `PUBLIC CONNECT`; global vault
  read внутри `jobs_db` закрыт. До production нужен повтор permission/HBA/login
  proof в целевом окружении. Роль с ownership объектов script отклоняет. Redis
  пока разделён только
  логически и использует общий пароль; отдельный Redis ACL/instance также
  остаётся production hardening.
- Job idempotency/lease migration намеренно fail-closed требует пустую
  pre-release таблицу `jobs`; для окружений с данными до deploy обязателен
  отдельный expand → backfill → validate → contract план.
- Validation registry пока хранит только текущую connector version: rolling
  deploy между enqueue и execution может дать `CONNECTOR_VERSION_CHANGED`.
  До production нужны N/N−1 version support либо queue drain перед rollout.
- Directus collection schema и seed появятся вместе с CMS vertical slice.
- Email-verification consumer ожидает подключения
  `@nats-io/jetstream`; plaintext verification token не логируется.
- QR для TOTP пока представлен локальным `otpauth://` URI и ручным ключом;
  UI QR появится после подтверждения зависимости `qrcode`.
- Rank/frequency provider execution, тарификация и YooKassa пока
  присутствуют только в ТЗ/схемах; tracking configuration, provider-free
  estimate, durable rank preparation Job и normalized SEO Data storage
  реализованы, но production provider worker snapshots ещё не создаёт.
  Arsenkin/Keys.so connectors сейчас выполняют только
  read-only credential validation; live Arsenkin `positions` заблокирован
  ADR-2026-034, XMLStock ждёт подтверждённого provider contract и redacted
  fixtures.
- `platform-app` сохранён как legacy Git-источник до проверки переноса; новая
  функциональность добавляется только в `platform-web`.

## 11. Правило обновления карты

Добавлять только информацию, необходимую следующему разработчику:

- новая граница;
- новый entrypoint;
- новая очередь/event;
- новая база/таблица;
- новый обязательный env;
- изменившийся startup/data flow;
- текущий незавершённый риск.

Детальные поля и UX не копировать сюда — давать ссылку на ТЗ или README сервиса.
