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
- UUID передаются строкой.
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
- повторной доставки внешнего webhook, если операция изменяет состояние.

Правила:

- scope: principal + workspace + endpoint;
- key хранится с hash request body и итоговым ответом;
- повтор с тем же body возвращает исходный результат;
- повтор с другим body возвращает `IDEMPOTENCY_CONFLICT`;
- retention ключа не менее 24 часов, для финансов — не менее срока возможной повторной доставки;
- in-progress повтор возвращает тот же command/job ID;
- idempotency API не отменяет уникальные ограничения и бизнес-транзакцию.

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
- trusted internal HTTP передаёт `workspaceId`, `projectId` и `actorId` и в
  заголовках, и в команде; jobs-сервис отклоняет любое несовпадение;
- raw rows, S3 object key, signed URL и внутренний текст dependency error
  публичный API не возвращает.

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

### 13.4. Сбор данных

- `/projects/{projectId}/tracking-contexts`;
- `/projects/{projectId}/rankings`;
- `/projects/{projectId}/rank-history`;
- `/projects/{projectId}/serp-snapshots`;
- `/projects/{projectId}/frequency-snapshots`;
- `/projects/{projectId}/competitors`;
- `/projects/{projectId}/data-collection/estimate`;
- `/projects/{projectId}/data-collection/run`;

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
- `identity.password-reset.requested.v1`;
- `identity.user.password-changed.v1`;
- `identity.user.mfa-enabled.v1`;
- `identity.user.mfa-disabled.v1`;
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
- `semantic.import.created.v1`;
- `semantic.import.parsed.v1`;
- `semantic.import.failed.v1`;
- `import.completed.v1`;
- `semantics.version.created.v1`;
- `seo.rank-check.completed.v1`;
- `seo.frequency-check.completed.v1`;
- `seo.serp-collected.v1`;
- `automation.run.completed.v1`;
- `report.snapshot.ready.v1`;
- `notification.requested.v1`;
- `audit.security-event.recorded.v1`.

Частый progress не отправляется в durable bus на каждую строку; worker агрегирует обновления.

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

- Socket.IO Redis adapter;
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
