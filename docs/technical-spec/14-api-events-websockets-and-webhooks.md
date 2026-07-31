# API, события, WebSocket и webhooks

## 1. Назначение

Раздел фиксирует публичные и внутренние контракты между:

- web-приложением и backend;
- административной панелью и backend;
- сервисами платформы;
- worker-процессами и очередями;
- real-time gateway и клиентами;
- платформой и внешними потребителями webhook.

Контракты должны позволять независимо выпускать совместимые версии приложений.

## 2. Общие правила HTTP API

### 2.1. Формат и версия

- Протокол: HTTPS.
- Формат: JSON UTF-8, кроме загрузки/выгрузки файлов и streaming endpoints.
- Публичный prefix: `/api/v1`.
- Admin prefix: `/admin-api/v1`.
- Internal prefix: `/internal/v1`; извне недоступен.
- Версия меняется только при несовместимом изменении.
- Совместимые поля добавляются без смены major version.
- Удаляемое поле помечается deprecated минимум на один публичный цикл релиза.
- Даты передаются в ISO 8601 UTC.
- UUID передаются строкой и валидируются на trust boundary. Каноническое
  lowercase-представление обязательно перед AAD, fingerprint, подписью,
  idempotency key derivation и любым строковым сравнением; PostgreSQL UUID
  остаётся источником нормализованного представления для обычных CRUD-путей.
- Decimal и `bigint`, способные превысить безопасный диапазон JavaScript, передаются строкой.
- Денежное значение передаётся как `{ amountMinor: "1250", currency: "USD" }`.
- У интерфейсных текстов API возвращает machine-readable code, а локализацию выполняет клиент.

### 2.2. Именование

- JSON-поля: `camelCase`.
- URL-ресурсы: существительные во множественном числе, `kebab-case`.
- Actions допустимы только для команд, не выражаемых CRUD: `/jobs/{id}/cancel`.
- Query filters: `filter[field]`.
- Сортировка: `sort=field,-createdAt`.
- Включение связанных данных: `include=owner,tags`.
- Выбор полей для публичного API: `fields=id,name,status`.

### 2.3. Контекст запроса

Каждый ответ содержит header:

- `X-Request-Id`;
- `X-Trace-Id`;
- `X-API-Version`;
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` для лимитируемых endpoint;
- `ETag` для кэшируемых или версионируемых ресурсов.

Клиент может передать:

- `X-Request-Id`;
- `Idempotency-Key` для команд;
- `If-Match` с версией/ETag при конкурентном изменении;
- `Accept-Language`;
- `X-Timezone` только для форматирования preview; хранение остаётся в UTC.

Workspace и project не принимаются «на доверии». Они извлекаются из URL и проверяются против прав текущего principal.

### 2.4. Cache и защитные response headers

Platform API использует fail-safe policy на глобальном Fastify `onSend`, а
не controller-local headers. Exact public allowlist состоит только из
`GET/HEAD /health/live`, `GET/HEAD /health/ready` и
`GET/HEAD /api/v1/system`; policy не навязывает им private cache semantics.
Все остальные ответы, включая auth, tenant и internal routes, неизвестные
пути, а также parser/guard/exception/404 до controller, принудительно
получают `Cache-Control: private, no-store`. Controller не может ослабить эту
policy публичным cache header.

Для private response глобальная граница объединяет, а не перезаписывает
существующий `Vary`: обязательны `Authorization`, `Cookie` и `Origin`, а для
preflight также `Access-Control-Request-Headers` и
`Access-Control-Request-Method`. Поэтому CORS и compression dimensions не
теряются. Security headers и production HTTPS/HSTS semantics определены в
разделе 15.

## 3. Аутентификация API

Поддерживаются:

- browser session в `HttpOnly`, `Secure`, `SameSite` cookie;
- короткоживущий access token для мобильных/внешних клиентов в будущем;
- personal/service API token;
- internal service identity через закрытую сеть и подписанный service JWT либо mTLS;
- одноразовый guest-report token с ограниченным scope.

Требования:

- CSRF-защита для cookie-authenticated mutation;
- refresh token rotation;
- token family revocation при повторном использовании;
- scope и workspace restrictions для API tokens;
- запрет передачи access token в query string;
- sensitive actions требуют недавней повторной аутентификации;
- disabled/suspended user или workspace блокируется до исполнения бизнес-команды.

До перехода на service JWT/mTLS sensitive credential vault использует
отдельный high-entropy caller token только для пары
`platform-api → jobs-integrations HTTP`. General
`PLATFORM_API_TO_JOBS_TOKEN`, migration и worker credentials не дают доступа
к credential endpoints.

## 4. Авторизация запроса

Проверка выполняется в порядке:

1. идентификация principal;
2. статус пользователя;
3. статус workspace;
4. членство или guest grant;
5. permission;
6. project membership/restriction;
7. resource ownership/visibility;
8. план, feature flag и quota;
9. optimistic version;
10. бизнес-инварианты.

Ответ `404` используется вместо `403`, если существование чужого tenant-ресурса не должно раскрываться.

## 5. Формат успешного ответа

Одиночный ресурс:

```json
{
  "data": {
    "id": "019...",
    "name": "Project"
  },
  "meta": {
    "requestId": "req_...",
    "version": 7
  }
}
```

Коллекция:

```json
{
  "data": [],
  "page": {
    "nextCursor": "opaque-value",
    "hasNext": false,
    "totalApprox": 0
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

`totalExact` возвращается только там, где точный `COUNT` не создаёт неприемлемую нагрузку. В крупных таблицах интерфейс использует approximate count или отдельную асинхронную агрегацию.

## 6. Pagination

### 6.1. Cursor pagination

Обязательна для:

- семантики;
- истории позиций;
- заданий;
- audit log;
- уведомлений;
- ledger;
- больших admin-списков.

Cursor:

- opaque;
- включает стабильный sort key и ID;
- подписывается либо кодируется без возможности произвольной подстановки;
- становится недействительным при несовместимой смене фильтра.

### 6.2. Offset pagination

Разрешена только для небольших справочников и CMS. Максимальный offset ограничивается.

## 7. Фильтрация и сохранённые представления

- Простые фильтры передаются query parameters.
- Сложный filter tree может передаваться `POST /.../search`.
- Search endpoint не изменяет состояние и не требует `Idempotency-Key`.
- Фильтры валидируются по allowlist полей и операторов.
- Regex от клиента запрещён для основных таблиц.
- Full-text search отделён от substring search.
- Saved view хранит versioned JSON DSL.
- Сервер возвращает нормализованный filter tree, чтобы клиент мог отобразить фактически применённые условия.

## 8. Ошибки

Единый формат:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The resource has changed",
    "requestId": "req_...",
    "details": {
      "resourceId": "019...",
      "expectedVersion": 4,
      "actualVersion": 5
    },
    "fieldErrors": [
      {
        "path": "name",
        "code": "REQUIRED"
      }
    ],
    "retryable": false
  }
}
```

Обязательные коды:

- `VALIDATION_FAILED` — 422;
- `UNAUTHENTICATED` — 401;
- `REAUTHENTICATION_REQUIRED` — 401;
- `FORBIDDEN` — 403;
- `NOT_FOUND` — 404;
- `METHOD_NOT_ALLOWED` — 405;
- `VERSION_CONFLICT` — 409;
- `RESOURCE_STATE_CONFLICT` — 409;
- `DUPLICATE` — 409;
- `IDEMPOTENCY_CONFLICT` — 409;
- `PAYMENT_REQUIRED` — 402;
- `FEATURE_NOT_AVAILABLE` — 403;
- `QUOTA_EXCEEDED` — 429;
- `RATE_LIMITED` — 429;
- `PROVIDER_RATE_LIMITED` — 429 или состояние job;
- `FILE_TOO_LARGE` — 413;
- `UNSUPPORTED_MEDIA_TYPE` — 415;
- `PROVIDER_UNAVAILABLE` — 503;
- `MAINTENANCE` — 503;
- `INTERNAL_ERROR` — 500.

В production ответ не содержит stack trace, SQL, secrets и исходный provider payload с чувствительными полями.

## 9. Идемпотентность

`Idempotency-Key` обязателен для:

- создания платного задания;
- checkout/top-up;
- импорта после подтверждения;
- массовых изменений;
- запуска automation вручную;
- создания export/report snapshot;
- создания workspace credential;
- запуска проверки workspace credential;
- повторной доставки внешнего webhook, если операция изменяет состояние.

Правила:

- scope: principal + workspace + endpoint;
- key хранится с hash request body и итоговым ответом;
- повтор с тем же body возвращает исходный результат;
- повтор с другим body возвращает `IDEMPOTENCY_CONFLICT`;
- retention ключа не менее 24 часов, для финансов — не менее срока возможной повторной доставки;
- in-progress повтор возвращает тот же command/job ID;
- idempotency API не отменяет уникальные ограничения и бизнес-транзакцию.

Credential create использует намеренно более строгий
`workspace + endpoint` scope: один ключ нельзя независимо переиспользовать
двум principal в одном workspace. Actor и нормализованный request входят в
keyed fingerprint под отдельным versioned keyring. Точный повтор возвращает
текущее masked-представление уже созданного credential; повтор после revoke
или тот же ключ с другим actor/body возвращает `IDEMPOTENCY_CONFLICT`. Это
явное исключение для resource-backed idempotency и не меняет требование
хранить исходный immutable response для финансовых и job-команд.

Credential validation является job-командой: её receipt lookup выполняется до
проверки текущего состояния credential, а request hash не включает изменяемые
provider/material version. Точный replay после rotate, disable или revoke
возвращает исходный validation Job; новый command key создаёт проверку уже
актуального material snapshot.

## 10. Optimistic concurrency

Версионируемые ресурсы:

- project settings;
- keyword editable fields;
- page assignments;
- saved views;
- dashboard layouts;
- integration bindings;
- automation definitions;
- roles;
- reports;
- Directus-independent application content.

Клиент передаёт `If-Match` или `expectedVersion`. При конфликте сервер возвращает:

- текущую версию;
- безопасный diff изменённых полей, если доступен;
- признак возможности автоматического merge;
- действия интерфейса: обновить, сравнить, повторить слияние.

Blind overwrite запрещён для bulk и совместно редактируемых сущностей.

## 11. Долгие операции

HTTP request не держится до завершения парсинга, импорта или отчёта.

Ответ на создание:

```json
{
  "data": {
    "commandId": "cmd_...",
    "jobId": "019...",
    "status": "queued",
    "estimatedCost": {
      "amountMinor": "350",
      "currency": "USD"
    }
  }
}
```

Клиент получает состояние через:

- `GET /jobs/{id}`;
- WebSocket events;
- уведомление;
- callback webhook для публичного API.

Job result указывает на domain result, export file или error report. Временная download-ссылка подписана и ограничена по сроку.

## 12. Файлы и multipart upload

### 12.1. Последовательность

1. `POST /uploads` с именем, размером, MIME и опциональным checksum.
2. Сервер проверяет лимит и возвращает multipart instructions.
3. Клиент загружает parts напрямую в S3-compatible storage.
4. Клиент вызывает `/uploads/{id}/complete`.
5. Backend сверяет parts и фактический размер объекта.
6. Antivirus/file inspection меняет статус `scanning`, потоково вычисляет
   обязательный серверный SHA-256 и сверяет клиентский checksum, если он был
   передан.
7. Файл становится `ready` или `rejected`.
8. Импорт создаётся только из `ready` upload.

Project API:

- `POST /api/v1/projects/{projectId}/uploads`;
- `POST /api/v1/projects/{projectId}/uploads/{uploadId}/parts`;
- `POST /api/v1/projects/{projectId}/uploads/{uploadId}/complete`;
- `GET /api/v1/projects/{projectId}/uploads/{uploadId}`;
- `DELETE /api/v1/projects/{projectId}/uploads/{uploadId}` до завершения.

Create/parts/complete/abort требуют CSRF и `file.upload`. Read endpoint требует
обычную session authentication, verified tenant context и `file.download`;
он не ограничивается actor-ом загрузки, поэтому статус видит уполномоченная
команда проекта.

### 12.2. Состояния upload

- `initiated`;
- `uploading`;
- `uploaded`;
- `scanning`;
- `ready`;
- `rejected`;
- `expired`;
- `aborted`.

Resumable upload должен переживать перезагрузку вкладки. Отдельные parts могут повторяться идемпотентно.

`upload.completed.v1` означает только успешное завершение S3 multipart и
переход в `uploaded`. После обязательной проверки outbox фиксирует ровно одно
из terminal events:

- `upload.ready.v1` — содержит server checksum и detected MIME;
- `upload.rejected.v1` — содержит безопасный rejection code.

События не содержат signed URLs, object key, исходное содержимое, credentials
или malware signature.

### 12.3. Создание и чтение импорта

- `POST /api/v1/projects/{projectId}/imports` создаёт import только из
  project-scoped upload в состоянии `ready`, требует `semantic.import`, CSRF
  и `Idempotency-Key`;
- `GET /api/v1/projects/{projectId}/imports/{importId}` требует
  `semantic.view` и возвращает только безопасный progress/preview/failure
  contract;
- `POST /api/v1/projects/{projectId}/imports/{importId}/mapping` требует
  `semantic.import`, CSRF и `If-Match`, сохраняет mapping/merge policy и
  запускает validation;
- `POST /api/v1/projects/{projectId}/imports/{importId}/publish` требует
  `semantic.import`, CSRF и `If-Match`, подтверждает validation preview и
  запускает chunked publish;
- `POST /api/v1/projects/{projectId}/imports/{importId}/cancel` требует
  `semantic.import` и CSRF; команда идемпотентна и не требует stale version,
  чтобы остановка долгой операции не блокировалась конкурирующим heartbeat;
- trusted internal HTTP передаёт `workspaceId`, `projectId` и `actorId` и в
  заголовках, и в команде; jobs-сервис отклоняет любое несовпадение;
- raw rows, S3 object key, signed URL и внутренний текст dependency error
  публичный API не возвращает.

Внутренний `seo-data` contract:

- `POST /internal/v1/semantic-imports/{importId}/normalize`;
- `POST /internal/v1/semantic-imports/{importId}/begin`;
- `POST /internal/v1/semantic-imports/{importId}/chunks`;
- `POST /internal/v1/semantic-imports/{importId}/complete`.

Все команды bounded, повторно валидируются владельцем данных и защищены
`JOBS_TO_SEO_DATA_TOKEN` плюс точным совпадением trusted tenant/actor headers
с body. Token получают только Jobs HTTP/import и SEO Data.

Внутренний transactional auth-email contract:

- `POST /internal/v1/auth-email-deliveries/{eventId}/material`;
- `POST /internal/v1/auth-email-deliveries/{eventId}/complete`.

Routes защищены отдельным `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`, требуют один
exact request ID, bounded exact body и `no-store`. Material возвращает только
`READY` с JIT recipient/locale/expiry/fragment-only action URL либо
`SKIPPED/NOT_DELIVERABLE` после повторной authoritative проверки. Completion
принимает только `DELIVERED` или `BOUNCED`; general Jobs credential эти routes
не открывает. `BOUNCED` для invite допустим только после hard recipient
rejection и подтверждённого redacted DLQ PubAck.

## 13. Основные группы endpoint

Полная OpenAPI-спецификация создаётся в `platform-contracts`. Обязательные группы:

### 13.1. Identity

- `/auth/register`;
- `/auth/login`;
- `/auth/logout`;
- `/auth/refresh`;
- `/auth/password/*`;
- `/auth/email-verification/*`;
- `/auth/oauth/{provider}/*`;
- `/auth/telegram/*`;
- `/auth/mfa/*`;
- `/sessions`;
- `/me`;
- `/me/export`;
- `/me/deletion`.

`POST /auth/logout`, `DELETE /sessions/{sessionId}`,
`DELETE /sessions/others`, password reset, MFA disable, refresh reuse и полное
refresh expiry используют terminal family revoke по ADR-2026-036. Rotation
обычного refresh не terminal. Ошибка outbox откатывает команду; для reuse и
expiry `UNAUTHENTICATED` формируется только после успешного commit.

### 13.2. Workspace и project

- `/workspaces`;
- `/workspaces/{workspaceId}`;
- `/workspaces/{workspaceId}/members`;
- `/workspaces/{workspaceId}/invites`;
- `/workspace-invites/accept`;
- `/workspaces/{workspaceId}/roles`;
- `/workspaces/{workspaceId}/projects`;
- `/projects/{projectId}`;
- `/projects/{projectId}/dashboard`;
- `/projects/{projectId}/audit-log`.

### 13.3. Семантика и страницы

- `/projects/{projectId}/keywords`;
- `/projects/{projectId}/keyword-groups`;
- `/projects/{projectId}/clusters`;
- `/projects/{projectId}/tags`;
- `/projects/{projectId}/custom-columns`;
- `/projects/{projectId}/saved-views`;
- `/projects/{projectId}/semantic-versions`;
- `/projects/{projectId}/pages`;
- `/projects/{projectId}/page-map`;
- `/projects/{projectId}/bulk-commands`;

Начальный query-контракт `GET /projects/{projectId}/keywords`:

- permission: `semantic.view`;
- query: `limit=1..200`, opaque `cursor`, опциональный `search` до 200
  Unicode-символов;
- сортировка: `createdAt DESC, id DESC`;
- response: collection envelope `data + page + meta`;
- `page`: `hasNext`, опциональные `nextCursor` и `totalApprox`;
- внутренний вызов `platform-api → seo-data` передаёт проверенные
  workspace/project/actor headers и использует короткий read timeout;
- `seo-data` повторно сопоставляет route project с trusted project context;
- внешний API никогда не раскрывает internal request ID и не доверяет форме
  ответа доменного сервиса без runtime validation.

### 13.4. Сбор данных

- `/projects/{projectId}/tracking-contexts`;
- `/projects/{projectId}/rankings`;
- `/projects/{projectId}/rank-history`;
- `/projects/{projectId}/serp-snapshots`;
- `/projects/{projectId}/frequency-snapshots`;
- `/projects/{projectId}/competitors`;
- `/projects/{projectId}/data-collection/estimate`;
- `/projects/{projectId}/data-collection/run`;

Реализованный tracking context API использует:

- `GET|POST /api/v1/projects/{projectId}/tracking-contexts`;
- `GET|PATCH /api/v1/projects/{projectId}/tracking-contexts/{contextId}`;
- `POST .../{contextId}/archive|restore`;
- `GET .../{contextId}/keywords`;
- `PUT|DELETE .../{contextId}/keywords/{keywordId}`.

Read требует `ranking.view`; mutations — `ranking.configure`, browser session
и CSRF. Create требует `Idempotency-Key`; PATCH/archive/restore —
`If-Match`. GET collection возвращает bounded 200 contexts,
`contextsTruncated` и access projection. Keyword list использует opaque
keyset cursor и limit `1..200`; point PUT/DELETE идемпотентны. Архивный
проект блокирует mutations, billing read-only оставляет чтение доступным.

Tenant/actor отсутствуют в public body. Platform API передаёт их в internal
headers/body, SEO Data повторно сверяет route project, trusted context и
command scope. Ответ SEO Data проходит строгую runtime-проверку workspace,
project, entity/configuration versions, temporal archive state и дочерних IDs.
Provider/credential/schedule не входят в tracking context по ADR-2026-033.

Реализованный provider-free этап manual flow по ADR-2026-034 добавляет:

- `POST /api/v1/projects/{projectId}/rank-estimates`;

Публичный execution-этап Platform API реализован:

- `POST /api/v1/projects/{projectId}/rank-runs`;
- `GET /api/v1/projects/{projectId}/jobs/{jobId}`;
- `POST /api/v1/projects/{projectId}/jobs/{jobId}/cancel`.

DTO и event contracts зафиксированы в `platform-contracts`: public create
содержит только `estimateId`, public Job не раскрывает provider/credential/
keyword/result internals, а internal границы описывают manifest seal/chunk,
normalized ingest и monotonic finalize. Platform API повторно проверяет
session, CSRF и project permissions, а Web использует только same-origin BFF.

Durable Jobs preparation уже доступен только по защищённым internal routes:

- `POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/rank-runs`;
- `GET /internal/v1/workspaces/{workspaceId}/projects/{projectId}/jobs/{jobId}`;
- `POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/jobs/{jobId}/cancel`.

Create отвечает `202 + internal Location`, требует exact tenant/actor
context и `Idempotency-Key`, повторно проверяет estimate и mutable execution
evidence и атомарно записывает `PREPARING` Job вместе с
`rank_job_runs`. Exact manifest command и hash фиксируются в PostgreSQL до
HTTP или BullMQ; queue payload содержит только `jobId`. Перед HTTP worker
сверяет command с persisted tenant/job/estimate/project/context binding.
Queue publish — bounded best effort: Redis partition не удерживает уже
принятый HTTP request, recovery остаётся DB-backed. GET возвращает строгую
public-safe Job projection. Cancel разрешает teammate с доверенным audit
actor, идемпотентно сохраняет terminal replay и не зависит от исходного
`actorId`.

Internal worker recovery использует states
`PENDING/OUTCOME_UNKNOWN/NOT_SEALED/SEALED/FINALIZED`, PostgreSQL lease и
единый порядок row locks `Job → RankJobRun` для мутаций существующего graph.
Cancel между seal request/response является единственным допустимым version
drift. Retryable transport/service ambiguity повторяет только exact
идемпотентную seal/finalize command в пределах 20 attempts; non-retryable
ambiguity или исчерпание budget завершают Job как
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`. Неидемпотентный provider submit ещё
не подключён. Durable pre-network authorize уже атомарно фиксирует
`SUBMITTING` и marker «bytes могли начаться»; после такой commit-точки
автоматический resubmit запрещён.

SEO Data manifest/finalize boundary уже реализована:

- `POST /internal/v1/projects/{projectId}/rank-manifests`;
- `GET /internal/v1/projects/{projectId}/rank-manifests/{manifestId}/chunks/{chunkIndex}?jobId=...`;
- `POST /internal/v1/projects/{projectId}/rank-manifests/{manifestId}/finalize`.

Она требует trusted tenant headers/body и отдельный
`x-rank-execution-token`, атомарно перепроверяет estimate scope и не вызывает
provider. Finalize делает exact replay, атомарно закрывает manifest и в
текущем срезе принимает zero-persisted
`CANCELLED/FAILED/ACTION_REQUIRED`. Успешный/частичный finalize закрыт
fail-closed до normalized ingest.

Estimate body содержит только `trackingContextId`. Endpoint требует
`ranking.view`, session, CSRF и `Idempotency-Key`, отвечает `201` immutable
пяти­минутным receipt и не вызывает provider. Billing read-only, отсутствие
`ranking.run`, DRAFT/ARCHIVED project, quota/entitlement и connector
несовместимость являются успешным `BLOCKED`, а не потерей read access.
Malformed/unauthenticated/forbidden/not-found/dependency и idempotency
conflict остаются HTTP errors.

Platform API передаёт Jobs только trusted project/workspace/access snapshot.
Jobs самостоятельно вызывает
`POST /internal/v1/projects/{projectId}/rank-estimate-scopes`, после чего
создаёт receipt через dedicated internal boundary
`/internal/v1/workspaces/{workspaceId}/projects/{projectId}/rank-estimates`.
Обе стороны строго сверяют path, headers, body и tenant-scoped response.

Будущий provider submit требует одноразовый authoritative execution grant;
неоднозначный submit имеет отдельный публично видимый status и не повторяется
автоматически. Issuer foundation Platform API уже предоставляет:

- `POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/rank-execution-grants`.

Endpoint защищён отдельным `X-Rank-Grant-Token`, требует single-value
`X-Request-Id`, tenant/actor headers и `Idempotency-Key` и сверяет их с
path/body. Response всегда имеет `Cache-Control: private, no-store`; новый immutable
decision — `201`, exact replay — `200`, conflict — `409`. TTL `GRANTED` ровно
30 секунд. Expired replay остаётся exact; Jobs client перепроверяет expiry по
часам `jobs_db`, сохраняет решение и атомарно связывает неистёкший grant с
secret-free `CONSUMED/READY_TO_SUBMIT` execution row. Request/response не
содержат binding/credential IDs или secrets; controlled-beta policy требует
authoritative quota reservation. SECURITY DEFINER connector
claim/authorize/runtime brokers вызываются isolated connector-worker и не
выдают ему table DML. Глобальный fail-safe `onSend` сохраняет private/no-store boundary
также для parser/guard/404 errors до controller.

Публичный Location первого rank slice всегда project-scoped. GET требует
`ranking.view`; cancel — `collector.cancel`, CSRF и пустой exact body.
`actorId` передаётся как audit actor и не ограничивает teammate access.
Чтение и cancel доступны в billing read-only/архивном проекте; повтор cancel
не переписывает terminal outcome.

`seo.rank-check.completed.v1` создаётся только для runtime-проверенного
`COMPLETED` или `PARTIALLY_COMPLETED`; inconsistent counts и
`ACTION_REQUIRED` отклоняются до публикации. Provider-effective execution,
scoped Arsenkin submit/poll/get, normalized ingest, position history,
completion outbox/event и schedules ещё не реализованы; live Arsenkin
execution выключен. Internal preparation API нельзя выдавать за готовые
публичные Platform API routes или рабочий съём позиций.

### 13.5. Imports/exports/jobs

- `/uploads`;
- `/projects/{projectId}/imports`;
- `/projects/{projectId}/exports`;
- `/jobs`;
- `/jobs/{jobId}`;
- `/jobs/{jobId}/cancel`;
- `/jobs/{jobId}/retry`;
- `/jobs/{jobId}/errors`;

### 13.6. Integrations и automation

- `/integrations/catalog`;
- `/workspaces/{workspaceId}/credentials`;
- `/workspaces/{workspaceId}/integration-bindings`;
- `/projects/{projectId}/integration-settings`;
- `/projects/{projectId}/automations`;
- `/projects/{projectId}/automations/{id}/runs`;
- `/projects/{projectId}/automations/{id}/pause`;
- `/projects/{projectId}/automations/{id}/resume`;

Реализованный workspace vault использует:

- `GET /api/v1/workspaces/{workspaceId}/integrations/catalog`;
- `GET /api/v1/workspaces/{workspaceId}/integrations/credentials`;
- `POST /api/v1/workspaces/{workspaceId}/integrations/credentials`;
- `PATCH /api/v1/workspaces/{workspaceId}/integrations/credentials/{id}`;
- `DELETE /api/v1/workspaces/{workspaceId}/integrations/credentials/{id}`;
- `POST /api/v1/workspaces/{workspaceId}/integrations/credentials/{id}/validations`;
- `GET /api/v1/workspaces/{workspaceId}/integrations/credentials/{id}/validations/{validationId}`.

Read требует `integration.view`, mutations соответственно
`integration.connect`, `integration.update`, `integration.delete`, session,
CSRF и проверенный workspace context. PATCH/DELETE требуют `If-Match`.
Запуск validation требует `integration.test`, recent authentication, CSRF и
`Idempotency-Key`, отвечает `202 Accepted`; чтение validation требует
`integration.view` и остаётся доступно в billing read-only режиме. Исходный
API key и account identifier отсутствуют в response contract.
Credential summary в list может включать `activeValidation` только текущего
material version. Это bounded projection active statuses, а не встроенная
история: partial unique гарантирует не более одной строки на
credential/material. Клиент использует её для возобновления GET polling после
reload и для присоединения к командной job после конкурентного `409`;
terminal результат читается из обычного credential status/`lastErrorCode`.
Точный повтор с тем же `Idempotency-Key` возвращает тот же Job. Пока для
текущего `credentialMaterialVersion` есть active Job, новый command key
получает `409 RESOURCE_STATE_CONFLICT`; после terminal state разрешён новый
validation.

Validation response содержит только `id`, workspace/credential IDs,
`credentialMaterialVersion`, provider, connector version, timestamps,
опциональные allowlisted `errorCode`/`retryAt` и один из статусов:
`QUEUED`, `RUNNING`, `RETRY_SCHEDULED`, `SUCCEEDED`,
`FAILED_RETRYABLE`, `FAILED_FINAL`, `STALE`. Клиент не считает
`RETRY_SCHEDULED` terminal. Rotate/revoke во время исполнения не позволяет
старому validation изменить credential и завершает его как `STALE`.
Server-side test сейчас доступен только для Arsenkin и Keys.so; XMLStock
возвращает нормализованную ошибку недоступной проверки до подтверждённого
provider contract.

Реализованные project connector settings используют:

- `GET /api/v1/projects/{projectId}/integration-settings`;
- `POST /api/v1/projects/{projectId}/integration-settings`;
- `PATCH /api/v1/projects/{projectId}/integration-settings/{bindingId}`.

GET требует `integration.view` и возвращает bindings, безопасные
credential options и access projection. Credential option содержит только
`id`, workspace, provider, label, mode, status и allowlisted capabilities:
secret, display hint, provider metadata и account identifier запрещены.
Массив ограничен 500 элементами; `credentialOptionsTruncated=true` сообщает
о наличии остальных, а credentials уже настроенных bindings обязаны остаться
в bounded ответе.
Чтение остаётся доступным в billing `READ_ONLY` и для архивного проекта.

POST/PATCH требуют `integration.update`, browser session и CSRF. POST требует
`Idempotency-Key`, отвечает `201` и возвращает entity version/ETag. PATCH
требует `If-Match`; capability и tenant context в public body отсутствуют,
binding ID берётся из path. Billing `READ_ONLY` даёт `402` до controller,
архивный проект — `409` до audit/internal RPC. Публичный API записывает
audit intent до RPC fail-closed. После commit Jobs сбой вторичной записи
success-audit логируется безопасно, но не превращает уже применённый POST/PATCH
в ложный `500`; durable truth результата — атомарный jobs outbox event, из
которого audit projection должна достраиваться после подключения durable
consumer.

Внутренняя граница:

- `GET|POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/integration-settings`;
- `PATCH .../integration-settings/{bindingId}`.

Она использует dedicated credential token и требует точного совпадения
workspace/project/actor в path, trusted headers и command body. Platform API
строго валидирует UUID, scope, bounded arrays, enums, timestamps, policies,
route consistency, duplicate IDs/capabilities и соответствие availability
текущему safe credential option. Неизвестное либо secret-bearing internal
поле превращает ответ в `502 DEPENDENCY_UNAVAILABLE`, а не протекает в Web.
Upstream `412` сохраняется как публичный `VERSION_CONFLICT` только с
положительным `currentVersion`; `IDEMPOTENCY_CONFLICT` и `DUPLICATE`
нормализуются без upstream message.

### 13.7. Collaboration и reports

- `/projects/{projectId}/comments`;
- `/projects/{projectId}/documents`;
- `/projects/{projectId}/reports`;
- `/reports/{reportId}/snapshots`;
- `/report-shares`;
- `/notifications`;
- `/notification-preferences`;
- `/me/notification-preferences`;
- `/me/push-subscriptions`;
- `/projects/{projectId}/notification-subscription`;

Рабочий contract предпочтений:

- `GET /api/v1/me/notification-preferences` — создаёт безопасный профиль по
  умолчанию при первом чтении и возвращает полную нормализованную матрицу;
- `PATCH /api/v1/me/notification-preferences` — требует browser session,
  CSRF и `If-Match`, заменяет профильные правила атомарно;
- `GET /api/v1/projects/{projectId}/notification-subscription` — требует
  `project.view`, возвращает membership snapshot, сохранённые правила и
  серверную effective policy;
- `PATCH /api/v1/projects/{projectId}/notification-subscription` — требует
  `project.view`, CSRF и `If-Match`; пользователь изменяет только собственную
  подписку доступного проекта.

Platform API передаёт realtime-сервису только проверенные заголовки
`X-Actor-Id`, `X-Workspace-Id`, `X-Project-Id`, `X-Membership-Id`,
`X-Membership-Version` и internal credential. Realtime-сервис повторно
валидирует совпадение заголовков с route/body и не принимает tenant context
непосредственно от browser. Project override, пытающийся включить глобально
выключенный канал, сохраняется как предпочтение, но effective policy всегда
возвращает канал выключенным с источником блокировки профиля.

Рабочий contract центра уведомлений:

- `GET /api/v1/notifications?limit&cursor&unreadOnly` требует session и
  возвращает `data`, `page.hasNext`, opaque `page.nextCursor` и актуальный
  `page.unreadCount`;
- `PATCH /api/v1/notifications/{notificationId}/read` требует session и CSRF,
  идемпотентно отмечает только собственное уведомление;
- `POST /api/v1/notifications/read-all` требует session и CSRF, возвращает
  число изменённых строк и единый `readAt`;
- cursor связан с `unreadOnly`; смена фильтра делает прежний cursor
  недействительным;
- item не содержит внутренний JSON `data`, dedupe key и delivery metadata;
- deep link принимается Platform API только если это локальный путь `/app`.

Внутренние эквиваленты находятся под
`/internal/v1/users/{userId}/notifications`. `userId` в URL обязан совпасть с
проверенным `X-Actor-Id`; browser не передаёт его самостоятельно.

Рабочий contract browser Web Push devices:

- `GET /api/v1/me/push-subscriptions` требует session и возвращает bounded
  redacted device list вместе с registration availability, VAPID public key/
  version и active-device limit; endpoint, browser keys, fingerprints,
  session family и internal IDs наружу не возвращаются;
- `PUT /api/v1/me/push-subscriptions/{installationId}` требует session, CSRF,
  recent authentication и принимает `ENABLE/RECONCILE`, device label, VAPID
  key version и browser `PushSubscription`; `userId`, `sessionFamilyId`,
  status и user-agent metadata browser body задавать не может;
- `PATCH /api/v1/me/push-subscriptions/{installationId}` требует session,
  CSRF и `If-Match`, меняет только label собственного устройства;
- `DELETE /api/v1/me/push-subscriptions/{installationId}` требует session и
  CSRF, идемпотентно переводит только собственное устройство в terminal
  `REVOKED` и уничтожает secret material;
- `installationId` — client-generated UUID установки из IndexedDB, а не
  identity/session identifier;
- registration возвращает только `deliveryAvailable=false` и
  `testDeliveryAvailable=false`, пока реальный sender выключен.

Platform API вызывает
`/internal/v1/users/{userId}/push-subscriptions/{installationId}` через
отдельный `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`, который должен
отличаться от general `PLATFORM_API_TO_REALTIME_TOKEN`. Он инжектирует
проверенные
`X-Actor-Id`, `X-Session-Family-Id`, request ID и нормализованную user-agent
metadata. Realtime повторно проверяет actor/route и exact endpoint origin
allowlist; endpoint/key material и dedicated token запрещены в logs, audit,
events и публичных errors. Полный lifecycle и release blockers определены
ADR-2026-035.

### 13.8. Billing

- `/workspaces/{workspaceId}/subscription`;
- `/workspaces/{workspaceId}/usage`;
- `/workspaces/{workspaceId}/balance`;
- `/workspaces/{workspaceId}/ledger`;
- `/workspaces/{workspaceId}/budgets`;
- `/billing/checkout`;
- `/billing/top-ups`;
- `/billing/invoices`;
- `/billing/yookassa/npd-receipts`;
- `/billing/yookassa/npd-receipts/{receiptId}`;
- `/billing/yookassa/npd-receipts/{receiptId}/register-manual`;
- `/billing/yookassa/npd-receipts/{receiptId}/deliver`;
- `/billing/yookassa/npd-receipts/{receiptId}/cancel`;

### 13.9. Toolbox, Radar, sitemap и Magnet

- `/tool-capabilities`;
- `/tools/{toolCode}/estimate`;
- `/tools/{toolCode}/run`;
- `/tools/{toolCode}/jobs/{jobId}`;
- `/public/tools/{toolCode}/run` — только anonymous-safe capabilities;
- `/projects/{projectId}/tools/{toolCode}/run`;
- `/projects/{projectId}/radar/configurations`;
- `/projects/{projectId}/radar/runs`;
- `/projects/{projectId}/page-changes`;
- `/projects/{projectId}/sitemaps`;
- `/projects/{projectId}/sitemaps/generate`;
- `/projects/{projectId}/magnet/estimate`;
- `/projects/{projectId}/magnet/sync`;
- `/projects/{projectId}/magnet/proposals`;
- `/projects/{projectId}/magnet/proposals/{id}/publish`.

Capability endpoint является источником доступности для public Toolbox,
project Toolbox, API docs и generated clients. UI не поддерживает отдельный
скрытый endpoint, отсутствующий в OpenAPI.

## 14. Bulk API

Bulk update принимает:

- explicit IDs до безопасного лимита; либо
- filter snapshot ID;
- ожидаемую filter version;
- command;
- dry-run flag.

Перед подтверждением сервер возвращает:

- точное или оценочное число строк;
- недоступные/пропущенные строки;
- конфликтующие данные;
- ожидаемую стоимость;
- возможность undo;
- preview изменений.

Большие операции всегда переходят в job. Результат содержит counts `selected`, `changed`, `skipped`, `failed`, `conflicted`.

## 15. Public API

Базовый публичный API всех доступных SEO-инструментов включён во все платные
тарифы. Тариф определяет quota, concurrency, retention и advanced scopes, но
не создаёт искусственную доплату только за API-доступ.

Требования:

- scoped API token;
- workspace/project allowlist;
- IP allowlist опционально;
- отдельные rate limits;
- audit каждого mutation;
- OpenAPI и examples;
- sandbox либо dry-run для платных команд;
- usage page;
- rotation без немедленного разрыва старого ключа;
- запрет возвращать provider credentials;
- pagination и async job модель идентичны основному API.
- каждый UI tool имеет публичный API operation либо явно документирован как
  локальная presentation-only функция;
- estimate, billing reservation, provenance и project permissions одинаковы
  для UI и API;
- anonymous `/public/tools` не является пользовательским API: он имеет малые
  IP limits, отдельную очередь и не принимает API tokens;
- Trial получает sandbox/ограниченный read API без системных платных расходов.

Документация:

- индексируемый портал — `https://example.com/docs/api`;
- versioned reference генерируется из `platform-contracts`;
- OpenAPI JSON — `https://api.example.com/openapi/v1.json`;
- интерактивный Explorer хранит token только в памяти вкладки;
- examples используют синтетические данные;
- breaking changes публикуются до отключения версии.

## 16. Межсервисные синхронные вызовы

Синхронный HTTP/gRPC вызов допустим, когда вызывающей стороне нужен ответ для продолжения текущего запроса:

- permission/entitlement decision;
- price estimate;
- credential reference resolution;
- короткий domain query.

Правила:

- timeout задан явно;
- retry выполняется только для идемпотентных операций;
- retry использует exponential backoff + jitter;
- circuit breaker;
- propagation `traceparent`, request ID и tenant context;
- service JWT короткоживущий и audience-bound;
- отсутствие каскада длиннее двух синхронных переходов;
- пользовательская операция не должна зависеть от ответа аналитического background consumer.

Текущий symmetric-token срез использует exact caller/audience matrix:

| Credential | Caller | Audience |
|---|---|---|
| `PLATFORM_API_TO_SEO_DATA_TOKEN` | Platform API | SEO Data general routes |
| `PLATFORM_API_TO_JOBS_TOKEN` | Platform API | Jobs HTTP general routes |
| `JOBS_TO_SEO_DATA_TOKEN` | Jobs HTTP/import worker | SEO Data Jobs routes |
| `PLATFORM_API_TO_REALTIME_TOKEN` | Platform API | Realtime general routes |
| `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN` | Jobs auth-email worker | Platform API JIT material/completion |

Legacy `INTERNAL_API_TOKEN` удалён из deploy configuration; его наличие
останавливает backend startup. Vault, rank manifest/result/grant и Web Push
device endpoints сохраняют отдельные dedicated credentials. Service-token
config принимает только distinct generated `32..512` visible ASCII без
whitespace/control/comma и example placeholders. Guard требует один exact
header и отклоняет duplicate/array/combined форму. Internal clients запрещают
redirect, поэтому authorization credential не переносится на другой origin.
Service JWT/mTLS остаётся целевой следующей identity boundary.

## 17. Доменные события

### 17.1. Envelope

```json
{
  "eventId": "019...",
  "eventType": "seo.rank-check.completed.v1",
  "occurredAt": "2026-07-28T12:00:00Z",
  "producer": "seo-data",
  "traceId": "...",
  "workspaceId": "019...",
  "projectId": "019...",
  "aggregate": {
    "type": "rankCheck",
    "id": "019...",
    "version": 3
  },
  "data": {},
  "metadata": {
    "correlationId": "019...",
    "causationId": "019..."
  }
}
```

### 17.2. Правила

- событие описывает свершившийся факт;
- event name не переиспользуется с новым смыслом;
- payload минимален и не содержит secrets;
- consumer не предполагает порядок между разными aggregates;
- порядок для aggregate обеспечивается partition key;
- доставка at-least-once;
- consumer обязан быть идемпотентным;
- schema проверяется в CI;
- PII маркируется в schema metadata;
- breaking change создаёт новую версию event type.

### 17.3. Transactional outbox/inbox

Producer в одной DB transaction:

1. изменяет domain entity;
2. добавляет запись outbox.

Publisher отправляет событие в NATS JetStream и помечает outbox published. Consumer:

1. проверяет inbox по `eventId`;
2. исполняет изменение;
3. фиксирует inbox и изменение одной транзакцией.

Повторная публикация и доставка не должны дублировать списания, задания, уведомления или агрегаты.

### 17.4. Обязательные события

- `identity.user.created.v1`;
- `identity.email-verification.requested.v1`;
- `identity.password-reset.requested.v1`;
- `identity.user.password-changed.v1`;
- `identity.user.mfa-enabled.v1`;
- `identity.user.mfa-disabled.v1`;
- `identity.session-family.revoked.v1`;
- `identity.user.suspended.v1`;
- `workspace.created.v1`;
- `workspace.invite.requested.v1`;
- `workspace.invite.accepted.v1`;
- `workspace.invite.revoked.v1`;
- `workspace.member.changed.v1`;
- `project.created.v1`;
- `project.archived.v1`;
- `project.deletion.requested.v1`;
- `billing.entitlement.changed.v1`;
- `billing.balance.changed.v1`;
- `billing.reservation.created.v1`;
- `billing.reservation.settled.v1`;
- `job.created.v1`;
- `job.progressed.v1`;
- `job.completed.v1`;
- `job.failed.v1`;
- `integration.credential-validation.finished.v1`;
- `integration.project-connector-binding.created.v1`;
- `integration.project-connector-binding.updated.v1`;
- `semantic.import.created.v1`;
- `semantic.import.parsed.v1`;
- `semantic.import.validated.v1`;
- `semantic.import.completed.v1`;
- `semantic.import.cancelled.v1`;
- `semantic.import.failed.v1`;
- `semantics.version.created.v1`;
- `seo.tracking-context.created.v1`;
- `seo.tracking-context.updated.v1`;
- `seo.tracking-context.archived.v1`;
- `seo.tracking-context.restored.v1`;
- `seo.tracking-context.keyword-assignment.changed.v1`;
- `seo.rank-check.completed.v1`;
- `seo.frequency-check.completed.v1`;
- `seo.serp-collected.v1`;
- `automation.run.completed.v1`;
- `report.snapshot.ready.v1`;
- `notification.requested.v1`;
- `audit.security-event.recorded.v1`.

Частый progress не отправляется в durable bus на каждую строку; worker агрегирует обновления.
`identity.session-family.revoked.v1` имеет aggregate
`session-family/{sessionFamilyId}`, version `1`, не имеет workspace/project и
содержит строго `userId`, `sessionFamilyId`, `revokedAt` ISO. Причина, session
ID, email, IP/user-agent и token material запрещены. Platform API пишет событие
одной транзакцией с условным terminal revoke только если реально изменена хотя
бы одна строка family. Повтор и rotation внутри family event не создают.
Точный payload типизирован в `platform-contracts`. Durable publisher и
Realtime consumer для этого exact event type реализованы. Platform API
publisher выбирает только `PENDING` identity rows, заново валидирует envelope,
публикует с event ID как deduplication ID и помечает `PUBLISHED` только после
валидного PubAck `IDENTITY_EVENTS`. Этот identity allowlist не доставляет
остальные event types.

Realtime durable pull consumer одной транзакцией записывает inbox, durable
revoked-family tombstone по `userId + sessionFamilyId` и terminal-отзывать
существующие devices. Device upsert проверяет tombstone под тем же
user/device lock до записи. Это обязательная защита от reorder
event-before-registration; простого `UPDATE active devices` недостаточно.
Source ack разрешён только после commit. Retryable processing error получает
bounded delayed NAK; permanent invalid или exhausted message сначала
публикует redacted DLQ envelope и требует exact DLQ PubAck.

Три transactional auth-email events типизированы в `platform-contracts` и
не содержат recipient, plaintext token, action URL, subject или body.
Identity payload содержит только `userId`, `oneTimeTokenId`, `locale`,
`expiresAt`; invite payload — `inviteId`, `workspaceId`, `expiresAt`.
Platform API публикует их в `{environment}.email.{eventType}` с outbox event
ID как `Nats-Msg-Id` и помечает `PUBLISHED` только после exact PubAck
`AUTH_EMAIL_EVENTS`. Jobs materialize-ит письмо JIT; source delivery остаётся
at-least-once, а durable attempt идемпотентен по event ID/type/hash. SMTP
accept не атомарен с DB receipt, поэтому stable `Message-ID` не является
exactly-once гарантией.

`integration.credential-validation.finished.v1` содержит только workspace,
credential/job IDs, provider, material/connector versions, terminal status и
allowlisted error code. Secret, provider response и account identifier
запрещены. Событие записывается transactional outbox одновременно с terminal
Job/credential update; текущий первый validation slice ещё должен добавить
эту запись перед включением email/Web Push.

`integration.project-connector-binding.created.v1` и `.updated.v1`
записываются в jobs outbox атомарно с binding transaction. Payload содержит
workspace/project/binding IDs, capability, enabled, route position/source,
provider/credential mode, fallback/budget mode, availability, version и
changedBy, а также allowlisted `changedFields`. Credential ID, label, display
hint, provider metadata и secret запрещены. Общий payload contract находится
в `platform-contracts`.

События `seo.tracking-context.created.v1`, `.updated.v1`, `.archived.v1` и
`.restored.v1` записываются в SEO Data outbox одной транзакцией с изменением
aggregate. Их общий payload содержит только `contextId`, `workspaceId`,
`projectId`, status, entity/configuration versions, search engine, device,
`changedBy` и allowlisted `changedFields` из `name/configuration/status`.
Название context, country/region/language, domain match value, keyword text,
URL, provider, credential, schedule, budget и raw configuration запрещены.

`seo.tracking-context.keyword-assignment.changed.v1` содержит только
workspace/project/context/keyword IDs, операцию `ASSIGNED/REMOVED` и
`changedBy`. Keyword text и значения колонок семантики в event не попадают.
Точный payload обоих семейств типизирован в `platform-contracts`. В текущем
срезе SEO Data producer создаёт transactional outbox rows, но publisher и
consumers этих event families ещё не включены; identity publisher Platform
API их не выбирает, а наличие строки нельзя интерпретировать как доставку в
NATS.

## 18. NATS subjects и consumers

Формат subject:

`{environment}.{domain}.{entity}.{event}`

Примеры:

- `prod.seo.rank-check.completed`;
- `prod.billing.entitlement.changed`.

Требования:

- отдельные credentials/permissions для publisher и consumer;
- durable consumers;
- ack only after transaction commit;
- bounded retry;
- dead-letter stream после исчерпания попыток;
- lag, redelivery и DLQ alerts;
- replay procedure документирована;
- replay не вызывает внешнее действие без идемпотентной защиты;
- production и staging используют разные accounts/streams.

Текущий exact identity topology:

- source subject:
  `{environment}.identity.session-family.revoked.v1`;
- source stream: `IDENTITY_EVENTS`, singleton subject, file/limits retention,
  max message `65536` bytes, bounded count/bytes/age и duplicate window;
- consumer: `realtime_session_family_revoked_v1`, durable pull, explicit ack,
  deliver all, instant replay, exact filter, `ack_wait=60s`,
  `max_ack_pending=1`, unlimited transport redelivery и file-backed state;
- DLQ subject:
  `{environment}.dlq.realtime.identity.session-family.revoked.v1`;
- DLQ stream: `DOMAIN_EVENTS_DLQ` включает exact identity и auth-email DLQ
  subjects с общей bounded file/limits retention.

One-shot provisioner создаёт topology до runtime и не получает application/
database secrets. Publisher, Realtime consumer, Jobs auth-email consumer,
provisioner и generic NATS runtime используют пять разных identities. Runtime
ACL разрешают только exact
event/API/request-reply/consumer fetch/source ack/DLQ subjects; CREATE и
UPDATE доступны только provisioner, а DELETE/PURGE/MSG.GET не выдаются.
Provisioner не исправляет unsafe identity/subject/transform/mirror/source/
sealed drift автоматически и завершает startup dependency ошибкой.

Publisher/consumer config, retry, payload и shutdown bounds валидируются при
startup; production запрещает отключить этот identity pipeline. Это не
отменяет требования lag/redelivery/DLQ alerts и replay runbook в целевом
окружении.

Transactional auth-email topology:

- stream `AUTH_EMAIL_EVENTS` содержит только три exact
  `{environment}.email.{eventType}` subjects;
- durable pull consumer `jobs_auth_email_v1` использует explicit ack и filter
  `{environment}.email.>`;
- redacted DLQ subject —
  `{environment}.dlq.jobs.transactional-email.v1` в `DOMAIN_EVENTS_DLQ`;
- отдельная `NATS_AUTH_EMAIL_CONSUMER_*` identity имеет только stream/
  consumer fetch/ack, DLQ publish и reply permissions;
- source ack выполняется после durable local outcome; invalid/exhausted
  message ack-ится только после подтверждённого DLQ PubAck.

Source/DLQ payload не переносит recipient/token/content или raw transport
error. Runtime worker не создаёт topology; rollback сохраняет stream, durable
consumer и pending attempts для replay/reconciliation.

## 19. WebSocket gateway

### 19.1. Connection

- Endpoint: `wss://<realtime-subdomain>/socket.io`.
- Authentication выполняется session/token при handshake.
- После соединения сервер повторно проверяет principal.
- Socket получает `connectionId`, `userId`, `sessionId`, `clientInstanceId`.
- Connection имеет TTL и периодическую revalidation permissions.
- При logout/revocation соответствующие sockets отключаются.

### 19.2. Rooms

- `user:{userId}`;
- `workspace:{workspaceId}`;
- `project:{projectId}`;
- `semantic-view:{viewId}`;
- `document:{documentId}`;
- `job:{jobId}`;
- `report:{reportId}`.

Join room — отдельная авторизуемая команда. Клиент не формирует произвольное tenant room name без серверной проверки.

### 19.3. Event envelope

```json
{
  "event": "semantic.cell-selection.changed.v1",
  "eventId": "ephemeral-or-durable-id",
  "serverTime": "2026-07-28T12:00:00Z",
  "sequence": 184,
  "scope": {
    "projectId": "019...",
    "viewId": "019..."
  },
  "data": {}
}
```

### 19.4. Ephemeral events

Не сохраняются как бизнес-история:

- presence heartbeat;
- cursor moved;
- cell selection changed;
- user is typing;
- viewport/focus hint.

Ephemeral payload:

- throttled;
- ограничен по размеру;
- не содержит значения скрытых ячеек;
- истекает по TTL;
- не записывается в основной audit log.

### 19.5. Durable UI events

- entity updated;
- comment added;
- job status/progress changed;
- notification created;
- report snapshot ready;
- permission changed;
- session revoked.

Durable event не является единственным источником данных. После reconnect клиент выполняет reconciliation через HTTP.

### 19.6. Reconnect

Клиент:

1. показывает состояние `reconnecting`;
2. сохраняет локальные несинхронизированные edits;
3. повторяет handshake с backoff;
4. передаёт last sequence для доступного окна;
5. получает missed events либо `resyncRequired`;
6. обновляет resource versions;
7. разрешает conflicts.

Presence исчезает через 15–30 секунд без heartbeat. Точное значение конфигурируется.

### 19.7. Масштабирование

- Socket.IO Redis adapter применяется только к tenant collaboration namespace;
  root namespace не создаёт Redis channels и остаётся in-memory;
- sticky sessions, если transport допускает polling;
- предпочтительно WebSocket-only после проверки сетевой совместимости;
- drain connections при deployment;
- instance heartbeats;
- metrics active connections, rooms, event rate, dropped events, reconnects;
- payload compression только после измерения CPU/traffic;
- hard limits на rooms и subscriptions одного клиента.

## 20. Yjs/Hocuspocus

Yjs используется только для совместных rich-text/board-like документов. Табличные domain edits остаются обычными командами с OCC.

Требования:

- Hocuspocus проверяет доступ при каждом connect и document load;
- document name не является полномочием;
- Yjs updates сохраняются и периодически compact в snapshot;
- awareness содержит имя, цвет, cursor/selection, но не секретные данные;
- ограничения размера update и документа;
- антиспам и rate limiting;
- версия/экспорт документа доступна вне CRDT;
- при удалении доступа connection закрывается;
- комментарии и task relations хранятся нормализованно, если являются бизнес-сущностями;
- серверный HTML генерируется санитизированно;
- attachments проходят общий upload pipeline.

## 21. Исходящие webhooks

### 21.1. Настройка

Workspace admin создаёт endpoint:

- HTTPS URL;
- набор событий;
- project filters;
- active/paused;
- signing secret;
- description;
- optional custom headers без secrets в открытом виде.

После создания secret показывается один раз. Поддерживаются rotation и overlap.

### 21.2. Доставка

Headers:

- `X-Platform-Event`;
- `X-Platform-Delivery`;
- `X-Platform-Timestamp`;
- `X-Platform-Signature-V1`.

Подпись: HMAC-SHA256 по `timestamp + "." + rawBody`. Consumer должен проверять допустимое отклонение времени.

Требования:

- at-least-once;
- уникальный delivery ID;
- timeout;
- exponential retry;
- ручной redelivery;
- disable после длительных постоянных ошибок;
- история response code/duration и обрезанного безопасного response body;
- SSRF-защита;
- запрет private/link-local/metadata адресов;
- повторная DNS/IP-проверка при доставке;
- максимальный payload;
- событие может содержать ссылку на API вместо тяжёлых данных.

Успешными считаются `2xx`. `410` может автоматически отключить endpoint. `429` и `5xx` повторяются. Другие `4xx` повторяются ограниченно.

## 22. Входящие webhooks

Для платежей и OAuth/provider callbacks:

- отдельный endpoint на провайдера;
- проверка подписи до парсинга доверенных полей;
- raw body сохраняется только в безопасной форме и по retention;
- dedup по provider event ID;
- быстрый `2xx` после постановки внутренней обработки;
- фактическое изменение идемпотентно;
- неизвестный объект не создаётся автоматически без бизнес-правила;
- clock tolerance;
- secret rotation;
- replay/admin tool;
- alert при signature failures.

## 23. API интеграций

Каждый provider adapter реализует унифицированные контракты:

- `validateCredential`;
- `getCapabilities`;
- `estimate`;
- `submit`;
- `poll` или webhook receive;
- `fetchPage`;
- `normalize`;
- `cancel`, если поддерживается;
- `classifyError`;
- `getRateLimitState`.

Normalized error classes:

- authentication;
- permission;
- invalid request;
- insufficient provider balance;
- rate limited;
- temporary unavailable;
- timeout;
- unsupported;
- invalid response;
- cancelled;
- permanent unknown.

Provider-specific поля допускаются в namespaced `metadata`, но продуктовые экраны работают на нормализованной модели.

Credential validation connector дополнительно обязан:

- выбирать origin, path, method и auth header только из versioned allowlist;
- запрещать пользовательский base URL и redirect;
- использовать HTTPS, короткий timeout и bounded retry;
- для `2xx` принимать только валидный JSON; для non-2xx сохранять безопасную
  status-классификацию даже при пустом/non-JSON body;
- ограничивать `Content-Length` и фактически прочитанный body;
- нормализовать `Retry-After` и ограничивать максимальную задержку;
- не возвращать raw body, provider headers или request с credential в API,
  логи, traces, queue или events.

Текущий Arsenkin/Keys.so validation использует лимит ответа 1 MiB и фиксированные
read-only account/limits endpoints. Это не даёт connector права выполнять
другие provider operations без отдельного capability и contract tests.

## 24. Rate limiting и abuse protection

Лимиты применяются на:

- IP для anonymous auth;
- IP/device для public Toolbox;
- account/session;
- API token;
- workspace;
- project;
- provider credential;
- дорогую capability;
- WebSocket connection/event type;
- guest report link.

Алгоритм — token bucket/sliding window. Платные операции дополнительно ограничены entitlement и balance reservation.

Rate limit должен:

- возвращать retry time;
- различать пользовательский и provider limit;
- не списывать средства за не начатую операцию;
- иметь admin visibility;
- не позволять одному workspace вытеснить остальных из общей очереди.
- не позволять anonymous Toolbox использовать reserved paid worker capacity.

## 25. OpenAPI, AsyncAPI и генерация типов

В `platform-contracts` хранятся:

- OpenAPI публичного и admin API;
- AsyncAPI/event schemas;
- WebSocket event schemas;
- webhook schemas;
- JSON Schema фильтров и automation definitions.
- capability registry schemas, связывающие web Toolbox, project Toolbox и API.

CI:

- валидирует спецификации;
- проверяет breaking changes;
- генерирует TypeScript clients/types;
- запускает contract tests;
- запрещает ручное дублирование DTO между репозиториями.

Сгенерированный клиент публикуется версионированным package. Server implementation проверяется на соответствие schema.

## 26. Наблюдаемость контрактов

Для каждого endpoint/event измеряются:

- request/event count;
- latency;
- error rate по machine code;
- payload size;
- retries;
- rate-limit hits;
- consumer lag;
- version distribution клиентов;
- provider latency и error class;
- WebSocket delivery/drop/reconnect.

Логи связываются по trace/correlation/job IDs, но не содержат access tokens, cookies, passwords и provider keys.

## 27. Критерии приёмки

- Все UI-команды используют документированные endpoint.
- OpenAPI проходит lint и breaking-change check.
- Async consumer безопасно обрабатывает повторную доставку одного события.
- Параллельное изменение версионируемого ресурса приводит к управляемому `409`, а не потере данных.
- Повтор платной команды с одним idempotency key не создаёт повторное списание или job.
- Upload 5 GB возобновляется после обрыва и проверяется до импорта.
- После временного разрыва WebSocket клиент восстанавливает актуальное состояние через resync.
- Пользователь без доступа не может join чужую room или получить факт существования ресурса.
- Webhook имеет проверяемую подпись, историю доставки и ручной redelivery.
- Secrets отсутствуют в логах, WebSocket payload и domain events.
