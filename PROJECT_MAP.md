# Карта проекта

Последнее обновление: 29 июля 2026 года

Текущий инкремент: versioned tracking contexts
Статус: project connector binding завершён; по ADR-2026-033 tracking context
принадлежит SEO data и хранит только immutable search configuration.
Provider остаётся в connector binding, schedule — в automation; context CRUD,
keyword assignments и UI находятся в разработке

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
- Tracking context не хранит provider/credential/schedule: его immutable
  search configuration принадлежит SEO data, routing — Jobs, schedule —
  automation.

## 2. Development workspace

Корневая папка координирует локальную разработку. Каждый `platform-*` каталог является независимой deployable/repository boundary и в дальнейшем может быть вынесен в отдельный Git-репозиторий.

| Каталог | Ответственность | Deployable |
|---|---|---|
| `platform-contracts` | HTTP/event/error contracts без бизнес-логики | npm package |
| `platform-api` | auth, workspace, project, billing, API gateway | да |
| `platform-seo-data` | semantics, pages, positions, competitors | да |
| `platform-jobs-integrations` | jobs, workers, connectors, S3/email ports | несколько entrypoints |
| `platform-realtime` | WebSocket presence/collaboration delivery | да |
| `platform-web` | public site, Toolbox, API docs и приложение `/app` | да |
| `platform-admin` | внутренняя административная панель | да |
| `platform-infrastructure` | Compose/Dokploy, monitoring, runbooks | конфигурация |
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

Platform API синхронно передаёт upload-команды в jobs-integrations через
internal HTTP с отдельным shared token и проверенным tenant/actor context.
Credential endpoints дополнительно используют отдельный
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`, доступный только Platform API и
jobs-integrations HTTP; общий internal token остальных сервисов vault не
открывает.
Проверка credential создаётся как канонический `Job` в PostgreSQL; BullMQ
получает только `jobId`. Отдельный execution-role connector worker забирает
lease и перед вызовом провайдера повторно проверяет workspace, material
version, connector version и состояние credential.
Project binding читается и изменяется через Platform API, а хранится только
в jobs/integrations. Public body не задаёт tenant/actor context; Platform API
передаёт его через тот же dedicated credential boundary и строго проверяет
scope/safe response перед возвратом в Web.
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
- `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN` отличается от
  `INTERNAL_API_TOKEN` и выдаётся только Platform API и credential-capable
  jobs/integrations HTTP process.
- BYOK envelope encryption использует отдельный
  `INTEGRATION_CREDENTIAL_KEYS` KEK keyring; auth encryption key для него не
  переиспользуется. Request fingerprint использует второй независимый
  `INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS` keyring. Management-role HTTP
  process получает оба keyring для create/rotate, execution-role connector
  worker получает только KEK для расшифровки перед allowlisted provider call;
  generic migration/system/import/inspection workers не получают ни один.
  Привязка `keyVersion → KEK bytes` immutable: существующей версии запрещено
  присваивать другое значение.
- Runtime role guard работает fail-closed: `DISABLED` отклоняет credential
  secrets, а `EXECUTION` — management/fingerprint/internal/NATS и S3/SMTP
  secrets. Это проверка конфигурации, а не криптографическая изоляция.
- Connector worker требует `INTEGRATION_CREDENTIAL_ROLE=EXECUTION` и
  отдельные `JOBS_CONNECTOR_DATABASE_USER` /
  `JOBS_CONNECTOR_DATABASE_PASSWORD`, а также
  `INTEGRATION_VALIDATION_TIMEOUT_MS`, `INTEGRATION_VALIDATION_LEASE_SECONDS`,
  `INTEGRATION_VALIDATION_DISPATCH_SECONDS`,
  `INTEGRATION_VALIDATION_CONCURRENCY`. Lease должен быть строго длиннее
  provider timeout с operational запасом; startup проверяет инвариант.
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

- `platform-api/src/identity` — account/session lifecycle и CSRF guards;
- `platform-api/src/identity/mfa.*`, `totp.*` — TOTP lifecycle, login
  challenge и recovery codes;
- `platform-api/src/authorization` — default-deny permission catalog и
  проверка tenant context;
- `platform-api/src/tenants` — workspace/project commands и queries;
- `platform-api/src/tenants/team.*` — приглашения, участники и проектные
  ограничения доступа;
- `platform-api/src/uploads` — project-scoped public upload commands;
- `platform-api/src/jobs` — общий internal HTTP client к jobs-integrations;
- `platform-api/src/integrations` — workspace-scoped public catalog/credential
  commands и project-scoped connector settings с RBAC, CSRF, audit intent,
  idempotency и optimistic locking;
- `platform-api/src/imports` — project-scoped create/read orchestration с
  `semantic.import`/`semantic.view`;
- `platform-api/src/semantics` — public project-scoped keyword queries с
  `semantic.view`;
- `platform-api/src/seo-data` — строго валидируемый internal read client к
  владельцу semantic core;
- `platform-api/src/notifications` — public profile/project notification
  preferences с CSRF, tenant authorization и optimistic locking;
- `platform-api/src/realtime` — строго валидируемый internal client владельца
  notification policy;
- `platform-api/src/audit`, `src/outbox` — переиспользуемые transactional
  записи аудита и событий;
- `platform-jobs-integrations/src/queue` — BullMQ connection, system,
  `upload-inspection` и идемпотентная
  `integration-credential-validation` queues;
- `platform-jobs-integrations/src/storage` — S3 port, disabled и S3 adapters;
- `platform-jobs-integrations/src/malware` — scanner port, disabled adapter и
  потоковый `clamd` INSTREAM adapter;
- `platform-jobs-integrations/src/internal` — fail-closed авторизация
  внутренних HTTP-команд;
- `platform-jobs-integrations/src/uploads` — multipart lifecycle, opaque
  object keys, size verification, lease/heartbeat inspection и upload outbox
  events;
- `platform-jobs-integrations/src/imports` — потоковый CSV/TSV parser,
  Key Collector header mapping, raw/validated staging, lease/heartbeat,
  validation summary и chunked publisher;
- `platform-jobs-integrations/src/integrations` — allowlisted provider catalog,
  workspace-scoped envelope vault с per-record DEK, AES-256-GCM и versioned
  KEK, отдельный versioned HMAC fingerprint keyring, dedicated caller guard,
  startup coverage guard, masked DTO, rotation, destructive secret overwrite
  при revoke, connector registry, lease/CAS state machine проверки credentials
  и нормализованные project binding/route/create receipt;
- `platform-jobs-integrations/src/seo-data` — строго валидируемый internal
  HTTP client владельца semantic core;
- `platform-seo-data/src/semantic-imports` — нормализация, import receipts,
  идемпотентное применение chunks и semantic version;
- `platform-seo-data/src/keywords` — tenant-scoped keyword read model,
  trigram search и cursor pagination;
- `platform-seo-data/src/internal` — fail-closed авторизация внутренних
  tenant/actor команд;
- `platform-jobs-integrations/src/email` — email port, disabled и SMTP adapters;
- `platform-realtime/src/realtime` — Socket.IO gateway и Redis adapter;
- `platform-realtime/src/notifications` — профильные правила, membership-bound
  проектные подписки, effective policy и user-scoped notification center;
- `platform-realtime/src/internal` — fail-closed internal HTTP authentication
  и проверенный actor/tenant/membership context;
- `platform-web/app` — public, tools, docs и private `/app` App Router screens;
- `platform-web/app/app/api` — same-origin browser BFF только к
  `/api/v1` Platform API;
- `platform-web/lib/protected-app.ts` — server-side session gate и безопасный
  refresh redirect;
- `platform-*/lib` и `components` — adapters и переиспользуемые UI-части;
- `platform-infrastructure/docker` — reusable backend/web images;
- `platform-infrastructure/postgres/init` — создание service databases;
- `platform-infrastructure/postgres/permissions` — идемпотентные fail-closed
  grants внутри `jobs_db` после migrations; первый script создаёт/ужесточает
  connector DB role и отклоняет ownership объектов кластера. DML ограничен,
  но текущий `SELECT` охватывает все строки и колонки `jobs` и
  `integration_credentials`, поэтому этот script не обеспечивает tenant/secret
  isolation и сам по себе не доказывает cross-DB isolation.

Entrypoints:

- API/SEO/realtime/jobs HTTP: `src/main.ts`;
- system worker: `platform-jobs-integrations/src/worker.main.ts`;
- upload inspection worker:
  `platform-jobs-integrations/src/inspection-worker.main.ts`;
- semantic import worker:
  `platform-jobs-integrations/src/import-worker.main.ts`;
- credential validation connector worker:
  `platform-jobs-integrations/src/connector-worker.main.ts`;
- connector DB permission init:
  `platform-infrastructure/postgres/permissions/jobs-connector.sql`, one-shot
  Compose service `jobs-connector-db-permissions`;
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
| Notifications | vertical slice: preferences → effective policy → read center |
| Integrations | vertical slice: catalog + encrypted BYOK vault + validation + project binding |
| Rankings | planned |
| Billing/YooKassa | planned |
| Directus content | planned |

Foundation содержит четыре валидные Prisma schemas и начальные migrations,
health/readiness, Redis/BullMQ, NATS transport, S3/SMTP adapters, fail-closed
WebSocket gateway, unified web/admin shell и Dokploy Compose.

Identity core содержит регистрацию email/password, consent snapshots,
Argon2id, email verification, одноразовое password recovery с отзывом прежних
сессий, TOTP/recovery codes с зашифрованными secrets и короткоживущим login
challenge, короткую access cookie, rotation refresh cookie, CSRF, session
inventory/revocation, PostgreSQL rate limit, audit и outbox.

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
кнопкой. Регистрация browser device, VAPID, email/Web Push delivery, digest и
delivery history пока не входят в этот срез.

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

## 8. Проверенное состояние

- Prisma Client generation: pass для 4 сервисов.
- Prisma schema validation: pass для 4 сервисов.
- TypeScript strict typecheck: pass для 8 пакетов.
- Platform API unit tests: 97 pass, 0 fail.
- SEO data unit tests: 10 pass, 0 fail.
- Jobs/integrations unit tests: 135 pass, 0 fail.
- Realtime unit tests: 12 pass, 0 fail.
- Contracts unit tests: 2 pass, 0 fail.
- Unified Web helper tests: 28 pass, 0 fail.
- NestJS production build: pass для 4 сервисов.
- Unified Next.js production build: pass; проверены public site, Toolbox,
  API docs и private `/app`.
- Compose config: pass с `.env.example`.
- Jobs migrations и connector column grants: pass на локальном PostgreSQL 16;
  отдельно проверены запреты `INSERT`, ciphertext/outbox access, ownership и
  `BYPASSRLS`. Целевой PostgreSQL 18 повторяется в staging.
- Resolved Compose topology: jobs runtimes имеют `internal,outbound`,
  connector не публикует ports и не получает management/NATS credentials.
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
- Integration settings browser QA: 1440 и 390 px, document overflow и browser
  errors не найдены; таблица/табы прокручиваются только внутри контейнеров,
  XMLStock full-secret replacement проверен интерактивно.
- Project connector settings: production build и same-origin BFF smoke pass;
  отдельно проверены cross-workspace deep link, reconnect race, immutable
  create replay, `412/409`, bounded options и mobile overflow. Интерактивный
  browser backend в текущем окружении недоступен, поэтому новый экран требует
  повторного visual smoke после удалённого deploy.
- Target runtime: Node.js 24. Локальная проверка выполнялась на Node.js 22 с
  ожидаемым engine warning; контейнеры используют Node.js 24.

## 9. Следующий вертикальный срез

`tracking context → manual BYOK rank job → position history`

Параллельный обязательный следующий срез уведомлений:
`profile/project effective policy → transactional outbox/durable consumer →
email + Web Push delivery`. Он включает browser device/VAPID lifecycle,
идемпотентные delivery attempts, retry/DLQ, digest и delivery history.
Production-зависимости `@nats-io/jetstream` и `web-push` ещё не одобрены, а
фактическая durable-доставка не реализована. OAuth/OIDC выполняется после
подтверждения зависимости `jose`; QR для TOTP — после подтверждения `qrcode`.

## 10. Незавершённые риски

- Дашборд использует честные empty states до первого SEO domain slice.
- Realtime не допускает вход в project rooms до общей token/permission проверки.
- Миграция backfill-ит `keyword_groups.path/path_hash` для корректного
  корневого дерева; orphan/cyclic legacy groups перед production требуют
  отдельного data-quality audit.
- `semantic_import_receipts` без chunks требуют bounded reconciliation/retention;
  receipt с применёнными chunks автоматически не удаляется.
- Durable outbox/inbox publisher и consumers ещё не реализованы.
- Notification preferences не создают deliveries сами по себе: отсутствуют
  transactional outbox/durable consumer, email/Web Push adapters, digest
  scheduler, Web Push device/VAPID lifecycle и provider delivery history.
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
- Coverage проверяет наличие версии, но не равенство её key material.
  Missing-version retry не защищает от ошибочной замены bytes под прежним
  `keyVersion`; такой системный mismatch нельзя превращать в массовый
  `DISABLED` валидных credentials. До production обязательны startup
  decrypt-canary/verifier для каждой используемой версии и/или глобальный
  decrypt-failure circuit breaker. Rollout: expand keyring → canary verify
  всех версий → drain старых replicas → switch active.
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
- Connector worker использует отдельный PostgreSQL login с ограниченным DML,
  но сейчас имеет `SELECT` всех строк и колонок `jobs` и
  `integration_credentials` внутри `jobs_db`. Компрометация execution
  process раскрывает job snapshots/metadata всех tenants и, при доступном KEK,
  весь BYOK vault этого database. До production это блокер: нужна узкая
  execution projection/table с серверным scope либо credential broker/KMS,
  исключающие глобальное чтение vault, а также fresh role provisioning,
  cluster-wide grant audit и `pg_hba`/отдельный cluster boundary. Роль с
  ownership объектов script уже отклоняет. Redis пока разделён только
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
- Rank/frequency connectors, тарификация и YooKassa пока присутствуют только
  в ТЗ/схемах. Реализованные Arsenkin/Keys.so connectors сейчас выполняют
  только read-only credential validation; XMLStock ждёт подтверждённого
  provider contract и redacted fixtures.
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
