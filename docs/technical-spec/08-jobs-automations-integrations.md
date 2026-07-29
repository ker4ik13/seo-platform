# Асинхронные задания, автоматизации и интеграции

## 1. Принцип

Любая операция, которая может превысить 2 секунды, затронуть более 1 000 строк, обратиться к внешнему API или потребовать расчёта стоимости, должна иметь возможность выполняться асинхронно.

## 2. Модель Job

Поля:

- `id`;
- `workspaceId`;
- `projectId`;
- `type`;
- `status`;
- `stage`;
- `priority`;
- `actorId`;
- `scheduleId`;
- `parentJobId`;
- `deduplicationKey`;
- `idempotencyScope`;
- `idempotencyKey`;
- `requestHash`;
- `inputSnapshot`;
- `scopeSnapshot`;
- `progressCurrent`;
- `progressTotal`;
- `progressUnit`;
- `estimatedCost`;
- `reservedCost`;
- `actualCost`;
- `currency`;
- `credentialMode`;
- `provider`;
- `attempt`;
- `maxAttempts`;
- `createdAt`;
- `queuedAt`;
- `startedAt`;
- `finishedAt`;
- `cancelRequestedAt`;
- `leaseOwner`;
- `leaseExpiresAt`;
- `retryAt`;
- `errorSummary`;
- `resultSummary`;
- `correlationId`;
- `version`;
- `updatedAt`.

`idempotencyScope + idempotencyKey + requestHash` образуют проверяемую
идемпотентную команду. Lease хранится в PostgreSQL и меняется через CAS по
`status + version + leaseOwner`; Redis/BullMQ не является источником истины.

## 3. Статусы Job

- `DRAFT`;
- `ESTIMATING`;
- `AWAITING_APPROVAL`;
- `RESERVING_BALANCE`;
- `QUEUED`;
- `WAITING_RATE_LIMIT`;
- `RUNNING`;
- `PAUSE_REQUESTED`;
- `PAUSED`;
- `CANCEL_REQUESTED`;
- `CANCELLED`;
- `RETRY_SCHEDULED`;
- `PARTIALLY_COMPLETED`;
- `COMPLETED`;
- `FAILED_RETRYABLE`;
- `FAILED_FINAL`;
- `EXPIRED`.

Статус и stage различаются: `RUNNING` может иметь stages `FETCHING`, `PARSING`, `SAVING`, `AGGREGATING`.

## 4. Job item

Для пакетных заданий создаются логические items/chunks:

- input reference;
- status;
- provider request ID;
- attempt;
- output reference;
- cost;
- error code;
- retryAt;
- timestamps.

Миллионы items не должны бесконтрольно храниться в Redis. Каноническое состояние хранится в PostgreSQL/staging/object storage, а Redis содержит очередь и оперативное состояние.

## 5. Идемпотентность

- POST запуска принимает `Idempotency-Key`.
- Повтор с тем же ключом и тем же payload возвращает существующий результат.
- Повтор с отличающимся payload возвращает конфликт.
- Provider callbacks и poll results также обрабатываются идемпотентно.
- Side effects биллинга используют отдельные уникальные ledger references.

## 6. Отмена и пауза

- Отмена является cooperative.
- Worker проверяет cancel flag между chunks и внешними запросами.
- Уже оплаченный provider request может быть завершён и сохранён.
- UI показывает, что отмена запрошена.
- Пауза сохраняет checkpoint.
- Не все job types поддерживают pause; это отражается в capabilities.

## 7. Retry

Классы ошибок:

- authentication;
- permission;
- invalid input;
- rate limit;
- provider temporary;
- network;
- parse;
- internal retryable;
- internal final;
- insufficient balance;
- cancelled.

Политика:

- exponential backoff с jitter для network/5xx;
- `Retry-After` имеет приоритет для 429;
- authentication не повторяется автоматически бесконечно;
- invalid input не повторяется;
- max attempts зависит от connector;
- retry только failed items;
- manual retry создаёт новую attempt chain.

Общее правило `network/5xx` не применяется к неидемпотентному provider
submit. По ADR-2026-034, если connector уже начал отправку Arsenkin `set`, но
не получил однозначный task ID, item переходит в `SUBMIT_OUTCOME_UNKNOWN`.
Такой item не попадает в auto-retry и failed-subset retry. UI требует
отдельного подтверждения нового запуска с предупреждением о возможном
повторном provider charge.

## 8. Очереди BullMQ

Базовые очереди:

- `imports`;
- `exports`;
- `rankings`;
- `serp`;
- `frequencies`;
- `suggestions`;
- `competitors`;
- `clustering`;
- `crawls`;
- `analytics-sync`;
- `reports`;
- `notifications`;
- `integration-credential-validation`;
- `public-toolbox`;
- `maintenance`.

Workers разделяются по профилю ресурсов:

- IO-bound;
- CPU-bound;
- browser-rendering;
- large-memory;
- report-rendering.

Manual rank job дополнительно разделяет process capabilities внутри одного
`platform-jobs-integrations` image:

- rank worker без KEK управляет manifest, fairness и persistence;
- connector worker с execution KEK выполняет только allowlisted provider
  calls и строгую нормализацию.

Это не новый сервис. До live rank submit connector role должен получать
scoped execution через SECURITY DEFINER operations, а не global read Job и
credential tables.

Rate limiting настраивается по provider и credential. Нельзя полагаться только на общий limiter очереди; connector поддерживает распределённые quota buckets.

## 9. Приоритеты и справедливость

Приоритеты:

- system critical;
- interactive high;
- paid priority;
- normal;
- background;
- maintenance.

Должна предотвращаться ситуация, когда один крупный workspace блокирует остальных:

- per-workspace concurrency;
- weighted fair scheduling;
- per-provider quota;
- per-credential quota;
- max active chunks per job;
- plan-based limits.
- anonymous/public-toolbox имеет отдельные concurrency и quota, всегда ниже
  project jobs и не может занять зарезервированную paid capacity;
- crawl/Radar дополнительно ограничивается глобально, per-workspace и per-host;
- billing, webhook reconciliation и security jobs имеют зарезервированную
  capacity, недоступную тяжёлым SEO workers.

## 10. Automation

Automation состоит из:

- trigger;
- conditions;
- action;
- scope;
- provider policy;
- budget policy;
- notification policy;
- timezone;
- status;
- version.

### 10.1. Triggers

- cron/schedule;
- data became stale;
- position changed;
- keyword entered/exited TOP;
- new issue;
- integration error;
- balance threshold;
- import completed;
- page published;
- webhook event;
- manual.

### 10.2. Conditions

- project/group/tag/view;
- frequency threshold;
- priority;
- severity;
- business hours;
- previous run status;
- maximum frequency;
- minimum balance;
- no equivalent active job.

### 10.3. Actions

- run collector;
- refresh stale data;
- create issue/task;
- send notification;
- generate/send report;
- execute webhook;
- switch provider;
- pause schedule;
- tag entities;
- create snapshot.

## 11. Automation builder

Шаги:

1. name and description;
2. trigger;
3. scope;
4. conditions;
5. action;
6. source/fallback;
7. budgets;
8. notifications;
9. test/dry run;
10. enable.

Показывается human-readable summary: «Каждый понедельник в 02:00 Europe/Moscow обновлять точную частотность запросов старше 60 дней в группе X, но не более N единиц и M валюты».

## 12. Защита автоматизаций

- monthly/daily budget;
- per-run max cost;
- max items;
- max duration;
- no overlapping run;
- skip or queue behavior;
- failure threshold;
- circuit breaker;
- auto-pause after consecutive failures;
- notification on auto-pause.

## 13. Job Scheduler

- Для повторяемых jobs используются актуальные BullMQ Job Schedulers.
- Scheduler ID стабилен и связан с Automation version.
- Изменение schedule выполняется upsert без дублирования.
- Timezone/DST тестируются отдельно.
- Пропущенный запуск имеет policy: skip, run once, catch up limited.
- Radar scheduler перед enqueue проверяет per-host budget, active crawl,
  billing read-only и backoff state; пропущенные crawl-запуски не образуют
  неограниченную очередь.

## 14. Интеграции: уровни

### Workspace integration

Credentials и OAuth connections принадлежат workspace.

### Project binding

Проект выбирает:

- разрешённые connectors;
- конкретное credential;
- primary/fallback;
- budgets;
- context mapping.

### Platform credential

Системный секрет платформы, доступный только connector worker и billing policy.

## 15. Credential modes

- `BYOK_API_KEY`;
- `BYOK_OAUTH`;
- `PLATFORM_INCLUDED`;
- `PLATFORM_PAID`;
- `FALLBACK_PLATFORM_PAID`.

В job сохраняется выбранный mode. Секрет в job payload не передаётся; передаётся credential reference.

## 16. Экран интеграций

Карточка показывает:

- provider;
- статус;
- credential mode;
- account label;
- scopes;
- доступные функции;
- balance/quota, если доступно;
- last success;
- last error;
- usage;
- projects using;
- test;
- rotate/reconnect/delete.

Статусы:

- not connected;
- connecting;
- pending verification;
- active;
- degraded;
- rate limited;
- low balance;
- token expiring;
- expired;
- revoked;
- invalid;
- provider outage;
- disabled by platform.

## 17. Добавление API-ключа

1. выбор provider;
2. описание возможностей и требуемого тарифа;
3. ввод секрета;
4. optional account identifier;
5. server-side test;
6. scopes/capabilities;
7. label and sharing scope;
8. default/fallback settings;
9. save.

Секрет после сохранения показывается только masked. Получить исходное значение нельзя; можно заменить.

### 17.1. Реализованные vault и credential validation

Текущий вертикальный срез реализует workspace-scoped BYOK vault для XMLStock,
Arsenkin Tools и Keys.so и асинхронную read-only проверку ключей Arsenkin и
Keys.so:

- Platform API повторно проверяет session, CSRF, recent authentication и
  workspace permission;
- vault endpoints принимают отдельный service token, доступный только
  Platform API и management-role jobs HTTP process; общий internal token
  других сервисов недостаточен;
- jobs/integrations является единственным владельцем ciphertext и
  канонического validation Job;
- случайный per-record DEK шифрует payload через AES-256-GCM, а отдельный
  versioned KEK шифрует DEK;
- payload AAD связывает ciphertext с workspace, provider и credential ID;
  AAD обёрнутого DEK дополнительно связывает его с KEK version;
- migration, system, import и inspection processes не получают credential
  keyring. Management role получает KEK и отдельный fingerprint keyring,
  execution role — только KEK для краткоживущей расшифровки перед provider
  request. Runtime config guard fail-closed отклоняет credential secrets у
  `DISABLED`, а у `EXECUTION` — management/fingerprint/internal/NATS и S3/SMTP
  secrets;
- response DTO, audit, events, queue и downstream job payload получают только
  credential/job IDs и безопасную metadata. Plaintext существует только в
  памяти create/full-replacement request или connector worker и не попадает в
  логи;
- XMLStock хранит `userId + apiKey` внутри одного зашифрованного payload;
- исходный секрет нельзя прочитать через пользовательский API;
- rotate заменяет ciphertext, увеличивает `material_version` и возвращает
  статус `PENDING_VERIFICATION`;
- revoke сразу soft-deletes запись и перезаписывает ciphertext случайными
  байтами;
- provider/base URL не принимается от пользователя;
- create credential и запуск validation требуют собственный
  `Idempotency-Key`. Для validation PostgreSQL хранит scope и 32-byte request
  hash, а стабильный активный deduplication key включает credential и material
  version. Partial unique index не допускает параллельный validation того же
  материала даже с разными command keys;
- workspace/actor/credential UUID канонизируются до lowercase до
  tenant-сравнения, AAD и fingerprint, чтобы PostgreSQL UUID round-trip не
  менял криптографический контекст.

Validation flow:

1. `POST .../credentials/{id}/validations` создаёт или возвращает
   идемпотентный Job со snapshot `credentialId + materialVersion +
   connectorVersion`. Секрет в snapshot не помещается.
   Receipt ищется до чтения изменяемого credential state; request hash
   включает immutable command scope `workspace + actor + credentialId`, а
   `materialVersion` используется только в execution snapshot и active
   deduplication key. Поэтому точный replay после rotate/disable/revoke
   возвращает исходный Job.
2. BullMQ queue `integration-credential-validation` получает только `jobId`.
3. Отдельный `connector-worker.main.ts` с
   `INTEGRATION_CREDENTIAL_ROLE=EXECUTION` забирает PostgreSQL lease.
4. Worker повторно проверяет workspace, credential state, material version и
   зафиксированную connector version и только затем расшифровывает секрет.
5. Arsenkin вызывает фиксированный
   `https://arsenkin.ru/api/tools/info`, Keys.so —
   `https://api.keys.so/limits/all`; пользователь не может изменить origin,
   URL, method или headers.
6. Provider request имеет timeout, `redirect: error` и ограничивает фактически
   прочитанный body одним MiB. Успешный `2xx` обязан быть валидным JSON;
   безопасный HTTP status и `Retry-After` неуспешного ответа классифицируются
   даже при пустом/non-JSON body. Наружу возвращаются только нормализованные
   status/error code и allowlisted account metadata.
7. Terminal transaction применяет результат только при прежнем
   `material_version`; rotate/revoke во время проверки даёт `STALE` и не
   изменяет новый credential material.
8. Retryable network/5xx/429 переводится в `RETRY_SCHEDULED`; `retryAt`
   учитывает bounded `Retry-After`, а periodic dispatcher восстанавливает
   пропущенные queue messages и просроченные leases. Его lease/retry indexes
   начинаются с `job.type`, чтобы typed dispatcher не сканировал jobs других
   типов.

Публичные validation states: `QUEUED`, `RUNNING`, `RETRY_SCHEDULED`,
`SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `STALE`. Terminal states —
`SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `STALE`; UI продолжает poll
для `RETRY_SCHEDULED` с учётом `retryAt`. GET результата требует
`integration.view` и должен работать в billing read-only режиме, POST требует
`integration.test` и блокируется, когда новые операции запрещены.

Credential list может содержать опциональный `activeValidation`, но только
для текущего `material_version`. Запрос фильтрует active statuses и stable
deduplication keys всех видимых credentials; partial unique ограничивает
результат одной job на credential, поэтому history не вычитывается в память.
Web гидратирует эту job после reload/navigation и продолжает только GET poll.
Если конкурентный участник создал job между list и POST, клиент после `409`
обязан перечитать authoritative list и присоединиться к найденной active job;
если она уже terminal, используются обновлённые credential status и безопасный
`lastErrorCode`. `sessionStorage` не является источником истины validation.

`PENDING_VERIFICATION` не разрешает SEO jobs использовать credential.
Arsenkin/Keys.so переходят в `ACTIVE` только после реального provider response.
Успешная проверка заменяет сохранённый список capabilities текущим allowlist
provider catalog. Новая документированная возможность поэтому становится
доступна существующему credential только после повторной внешней проверки, а
удалённая возможность сразу отсекается пересечением с каталогом.
XMLStock остаётся `PROVIDER_DOCUMENTATION_REQUIRED`: локальная расшифровка не
выдаётся пользователю за внешний test до подтверждённого provider contract и
redacted fixtures.

Management API принимает только полную замену secret payload и не вызывает
провайдера. Public decrypt adapter разрешён только role `EXECUTION`, однако
оба процесса пока получают один symmetric KEK: компрометация management
process технически позволяет выполнить unwrap вне adapter. До production
нужна криптографическая граница через KMS/asymmetric wrapping либо отдельный
credential broker, закреплённая ADR; execution process также не получает
fingerprint keyring/credential API token. Connector worker уже использует
отдельный PostgreSQL login с ограниченным DML, но текущий grant разрешает
`SELECT` всех строк и колонок `jobs` и `integration_credentials` внутри
`jobs_db`. Это не tenant/secret isolation: при компрометации execution process
доступны job snapshots/metadata всех tenants и, с имеющимся KEK, весь BYOK
vault database. До production широкий read grant блокирует release: нужна
узкая execution projection/table с проверенным server-side scope либо
credential broker/KMS, исключающий чтение всего vault. Отдельно обязательны
fresh role provisioning, cluster-wide grant audit и
`pg_hba`/отдельный cluster boundary; ownership объектов кластера script
проверяет и отклоняет fail-closed. Отдельный Redis ACL/instance также остаётся
обязательным.

Startup fail-closed сверяет используемые в БД KEK/fingerprint versions с
соответствующими keyrings. Автоматический bounded DEK rewrap и отдельная
bounded-инвалидация fingerprints после retry window остаются обязательным
operational hardening до удаления старых версий. Отображение
`keyVersion → KEK bytes` immutable: новое значение всегда получает новую
версию. Rollout выполняется только как expand keyring → startup canary verify
каждой используемой версии → drain старых replicas → switch active.

Текущий coverage guard проверяет наличие версии, а missing-version retry
оставляет credential без изменений при её отсутствии. Они не обнаруживают
неверные bytes, ошибочно записанные под существующим `keyVersion`. Startup
decrypt-canary/verifier и/или глобальный decrypt-failure circuit breaker пока
не реализованы и являются production release blocker: массовый системный
mismatch должен останавливать execution и поднимать incident, а не переводить
валидные credentials в `DISABLED`.

Runtime validation ограничивает provider timeout диапазоном
`1 000–120 000 ms`, lease — `10–600 s` и минимум `timeout + 5 s`,
dispatcher — `5–300 s`, concurrency — `1–32`. Первый validation допускает
не более трёх attempts; exponential delay ограничен 300 секундами, а
provider `Retry-After` — 3 600 секундами.

Первый worker имеет общий BullMQ limiter и DB-enforced single-active cap на
credential/material. Перед multi-tenant beta обязательны server-side
per-workspace/provider quotas и fair scheduling. Terminal validation result
также должен записывать redacted
transactional outbox event для durable audit и email/Web Push; audit записей
`requested/queued` в Platform API для этого недостаточно.

### 17.2. Реализованная проектная привязка connector

Jobs/integrations владеет нормализованными
`project_connector_bindings`, `project_connector_routes` и
`project_connector_binding_create_receipts`. На
`workspace + project + capability` разрешён один binding; удаление в
пользовательском flow отсутствует, выключение выполняется через
`enabled=false`.

Первый slice поддерживает один route:

- `position=0`;
- `sourceKind=WORKSPACE_CREDENTIAL`;
- non-deleted credential того же workspace;
- mode только `BYOK_API_KEY`;
- status `ACTIVE` при create, включении или смене route;
- capability одновременно присутствует в сохранённом credential JSON и
  текущем provider catalog.

Если credential после настройки стал pending/invalid/revoked или потерял
capability, GET сохраняет binding и возвращает явный availability. Отключение
текущего сломанного route разрешено без повторной проверки `ACTIVE`; включение
или замена credential всегда проверяются заново. Автоматическое переключение
на системный ключ запрещено.

Bindings и credential options читаются в одной interactive transaction с
`RepeatableRead`, чтобы rotate/revoke не формировал взаимоисключающие
проекции. Aggregate ограничен 500 credential options и возвращает
`credentialOptionsTruncated`; credentials уже назначенных bindings остаются в
bounded выдаче. Полный выбор сверх лимита появится в отдельном cursor/search
endpoint. Create, enable и route swap выполняют tenant-scoped
`SELECT ... FOR SHARE` credential внутри write transaction; конкурентный
rotate/revoke ждёт её завершения. Отключение неизменённого сломанного route
lock не требует.

Create binding использует тот же строгий шаблон платных команд:

- trusted workspace/project/actor берутся из совпадающих path, headers и
  internal body;
- обязательный `Idempotency-Key` связан 32-byte hash с полным каноническим
  command;
- binding, route, immutable create receipt, исходный safe response snapshot и
  redacted outbox event записываются одной транзакцией;
- точный replay после последующего PATCH возвращает исходный create snapshot,
  а другой command с тем же ключом — `IDEMPOTENCY_CONFLICT`;
- snapshot строго валидируется и обязан совпадать с tenant/binding scope
  receipt.

PATCH использует CAS по положительной `version`; проигравший запрос получает
HTTP `412 VERSION_CONFLICT` и только безопасный `currentVersion`. Outbox
события `integration.project-connector-binding.created.v1` и
`.updated.v1` содержат capability, provider/mode, availability и version, но
не содержат credential ID, label, display hint, provider metadata или secret.
Payload использует общий versioned contract из `platform-contracts` и
allowlisted `changedFields`; смена route между двумя credentials одного
provider видна consumer без раскрытия идентификаторов ключей.

Platform credentials, fallback и binding budgets пока строго возвращают
`FEATURE_NOT_AVAILABLE`: они появятся только вместе с commercial agreement,
price book, estimate/reservation/settlement и hard budget. Сам binding ещё не
запускает provider operation и не доказывает готовность rank tracking.

Между проверкой lifecycle проекта в Platform API и commit в отдельной
jobs database остаётся межсервисное TOCTOU. До первого исполняемого SEO job
jobs/integrations должен получить authoritative lifecycle projection/inbox
либо другую проверяемую precondition; worker в любом случае повторно проверяет
workspace/project/billing перед provider call.

## 18. OAuth connections

- OAuth state хранится server-side.
- Refresh token шифруется.
- Scopes минимальны.
- Пользователь видит предоставленные permissions.
- Disconnect отзывает локальное connection и по возможности provider token.
- Token refresh выполняется централизованно.
- Ошибка refresh переводит connection в `REAUTH_REQUIRED`.

## 19. Connector interface

Каждый connector реализует:

- metadata;
- capabilities;
- credential schema;
- validateCredential;
- fetchQuota/balance;
- estimate;
- normalizeInput;
- execute или submit/poll/get;
- cancel, если поддерживается;
- parseResponse;
- normalizeError;
- calculateActualCost;
- healthCheck;
- redact;
- version.

Результат connector преобразуется в канонические модели платформы. Сырой ответ не должен протекать в доменную логику.

## 20. Версионирование connector

- Connector имеет semantic version.
- Job фиксирует version.
- Parser changes не меняют старые snapshots молча.
- Возможен reparse raw response новым parser как отдельный job.
- Deprecation провайдера сопровождается миграционным уведомлением.

Первый credential-validation registry хранит только текущую версию и
fail-closed завершает Job с `CONNECTOR_VERSION_CHANGED`, если snapshot не
совпадает. Это безопасно, но не является production rollout strategy: до
multi-replica deployment registry должен поддерживать N/N−1 до drain старых
jobs либо rollout обязан сначала остановить новые команды и дождаться пустой
очереди.

## 21. Начальные connectors

Приоритет P2:

1. XMLStock;
2. Arsenkin Tools;
3. Keys.so.

Яндекс Wordstat API, XMLRiver, Яндекс Вебмастер, Яндекс Метрика, Google Search Console и Google Analytics 4 остаются в целевой архитектуре, но реализуются после первой тройки либо раньше только при отдельном продуктовом решении.

### 21.1. Яндекс Wordstat API

Функции:

- top requests;
- dynamics;
- regions;
- device filters, если поддерживаются;
- OAuth bearer token;
- сохранение request context.

Connector учитывает provider quotas и не подменяет официальные значения вычисленными.

### 21.2. XMLRiver

- Яндекс/Google SERP;
- regions/languages/devices;
- result depth;
- organic results;
- special blocks;
- indexation options, если доступны;
- XML parsing;
- balance and provider errors.

### 21.3. XMLStock

- Яндекс/Google SERP;
- Wordstat;
- официальные и live-инструменты провайдера;
- XML/JSON/HTML response modes;
- balance, load and tariff metadata, если API разрешает.
- режимы первого релиза: BYOK и developer/partner integration;
- platform-paid режим включается только после согласования допустимой схемы коммерческого использования;
- `soft_id`/партнёрская атрибуция поддерживаются как часть connector configuration.

### 21.4. Keys.so

- REST JSON;
- API token header;
- domain/keyword reports;
- competitor keywords/pages;
- SERP tasks;
- async `202` polling;
- `429 Retry-After`;
- provider report IDs.
- в первом релизе используется только BYOK;
- пользователь должен иметь тариф Keys.so с доступом к API;
- общий ключ платформы запрещено включать до подписания отдельного соглашения, разрешающего предоставление данных пользователям платформы;
- интерфейс должен явно указывать, что подписка Keys.so оплачивается пользователем отдельно.

### 21.5. Arsenkin Tools

- Bearer token;
- submit/check/get task lifecycle;
- лимит одновременных задач;
- запросный rate limit;
- съём позиций через документированный `positions` tool с поисковой системой,
  регионом и глубиной;
- clustering;
- indexation and supported SEO tools;
- provider task cleanup.
- в первом релизе используется BYOK;
- пользователь должен иметь тариф Arsenkin Tools с API;
- platform-paid режим включается только после согласования с провайдером коммерческой схемы и передачи результатов третьим лицам;
- connector учитывает не более пяти одновременных задач и общий запросный rate limit провайдера.

### 21.6. Яндекс Вебмастер

- OAuth;
- sites;
- verification status;
- indexing diagnostics;
- search queries and statistics;
- sitemap data;
- API version stored in connector.

### 21.7. Яндекс Метрика

- OAuth;
- counters;
- reports;
- dimensions/metrics;
- goals/conversions;
- quota-aware sync.

### 21.8. Google Search Console

- OAuth;
- properties;
- Search Analytics;
- Sitemaps;
- Sites;
- URL Inspection;
- dimensions country/device/query/page/date;
- quota-aware incremental sync.

### 21.9. Google Analytics 4

- OAuth or service account where appropriate;
- Data API;
- metadata discovery;
- `runReport`/batch;
- pages, traffic, engagement and key events;
- pagination;
- quota tokens.

### 21.10. Telegram

- user authentication;
- workspace notification bot;
- user/chat binding;
- report and alert delivery;
- delivery result.

### 21.11. Email

- transactional provider abstraction;
- рекомендуемый первый transport — Unisender Go через API/SMTP;
- templates by locale;
- bounce/complaint handling;
- unsubscribe for non-transactional messages;
- delivery events.

### 21.12. Webhooks

- outbound signed webhooks;
- inbound automation triggers;
- retry and delivery log;
- endpoint verification.

### 21.13. Magnet

Magnet — не новый внешний provider, а orchestration над:

- Google Search Console;
- Яндекс Вебмастер;
- Google Analytics 4;
- Яндекс Метрика.

Сценарий:

1. пользователь выбирает подключения, период, property/site и country/device;
2. sync job сохраняет source snapshots без смешивания несовместимых метрик;
3. staging строит объединённое предложение запросов;
4. запросы помечаются как `NEW`, `EXISTING`, `CONFLICT` или `IGNORED`;
5. preview показывает query, landing page, impressions, clicks, CTR, average
   position, sessions/conversions и источник каждого поля;
6. пользователь фильтрует и выбирает строки;
7. publish job дедуплицирует их, сохраняет provenance, создаёт/обновляет
   keywords и при необходимости предлагает group/page mapping;
8. результат можно запланировать как регулярный discovery, но автоматическое
   добавление в ядро выключено по умолчанию.

Один provider error создаёт partial result, не уничтожая данные остальных.
Повторный sync идемпотентен по connection/property/date/dimensions и не создаёт
дублирующие keywords.

## 22. Platform-key usage

При отсутствии BYOK:

1. Policy проверяет тариф и доступность функции.
2. Estimate рассчитывается по актуальному price book.
3. Создаётся balance reservation.
4. Credential broker выдаёт worker краткоживущий access reference.
5. Connector выполняет запрос.
6. Usage metering фиксирует provider units.
7. Ledger списывает actual cost.
8. Секрет не попадает в API, WebSocket и пользовательские логи.

На старте platform-paid разрешён только для provider/capability, по которому одновременно выполнены условия:

- договор или публичные условия разрешают выбранную модель использования;
- настроен действующий price book;
- подтверждены минимальные обязательства и лимиты провайдера;
- forecasted оплаченный спрос покрывает фиксированную стоимость provider account;
- включены hard daily/monthly budgets и аварийное отключение;
- проведён reconciliation test.

Наличие технического API само по себе не означает право перепродавать результаты или предоставлять общий доступ.

## 23. Provider price book

Содержит:

- provider;
- operation;
- unit;
- provider cost;
- customer price;
- currency;
- minimum charge;
- effective period;
- plan overrides;
- region/device modifiers;
- version.

Job фиксирует price book version.

Customer price вычисляется не как произвольная наценка, а по формуле, учитывающей:

- фактическую стоимость provider unit;
- неиспользованные/сгорающие обязательные пакеты;
- прямую стоимость worker/storage/traffic;
- комиссию платёжного провайдера;
- налоговый резерв;
- резерв изменения цены/курса;
- целевую contribution margin.

Price book автоматически блокирует публикацию цены ниже установленного floor.

## 24. Circuit breaker

Для connector/credential:

- closed;
- open;
- half-open.

Открывается по:

- error rate;
- consecutive failures;
- provider outage;
- authentication failure;
- balance depletion.

UI показывает degraded provider. Jobs либо ждут, либо применяют fallback policy.

## 25. Внутренняя панель операций

Platform operations видит:

- queues;
- worker capacity;
- lag;
- provider health;
- rate limits;
- credential pools;
- failed jobs;
- retry storms;
- costs and margin;
- circuit breakers;
- DLQ;
- manual replay.

Любой replay идемпотентен и аудитируется.
