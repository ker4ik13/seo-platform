# platform-jobs-integrations

Владелец асинхронных jobs, расписаний, provider connectors, импортов и внешних доставок.

## Entry points

- `src/main.ts` — internal HTTP API и readiness;
- `src/worker.main.ts` — system BullMQ worker;
- `src/inspection-worker.main.ts` — потоковая проверка uploads;
- `src/import-worker.main.ts` — парсинг, validation и publish семантики;
- `src/rank-worker.main.ts` — DB-first подготовка immutable rank manifest,
  восстановление потерянных queue messages и cooperative cancel;
- `src/connector-worker.main.ts` — provider calls с минимальной
  `EXECUTION`-ролью credential vault;
- `src/auth-email-worker.main.ts` — transactional verification/reset/invite
  SMTP delivery с durable PostgreSQL recovery и без Redis.

Worker entrypoints разделяются по профилю нагрузки и набору секретов, а не по
каждой операции.

## Межсервисная и process capability граница

Legacy `INTERNAL_API_TOKEN` удалён и при наличии fail-closed отклоняется на
startup. Обычный Jobs HTTP принимает только
`PLATFORM_API_TO_JOBS_TOKEN` от Platform API, а исходящие Jobs HTTP/import
вызовы SEO Data используют `JOBS_TO_SEO_DATA_TOKEN`. Vault и project binding
остаются за отдельным `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`; rank manifest,
grant/result и auth-email JIT boundaries не переиспользуют general
credentials. Последний защищён только `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`.

Текущий один image запускается с точными ролями и наборами возможностей:

| Process | Разрешённые runtime capabilities |
|---|---|
| `jobs-integrations` HTTP | Jobs DB, Redis, NATS, S3, general Platform API/SEO Data tokens и credential-management token/keyrings |
| `import-worker` | Jobs DB, Redis, S3 и `JOBS_TO_SEO_DATA_TOKEN` для semantic publish |
| `upload-inspection-worker` | Jobs DB, Redis, S3 и malware scanner |
| `system-worker` | только Redis и bounded concurrency; без DB и service/provider secrets |
| `rank-worker` | Jobs DB, Redis, SEO rank-manifest token и Platform rank-grant token; без general/NATS/S3/SMTP/vault capabilities |
| `connector-worker` | `jobs_connector` DB boundary, Redis и execution KEK; без general/management/NATS/S3/SMTP tokens |
| `auth-email-worker` | `jobs_auth_email_runtime`, dedicated NATS consumer, Platform JIT token и SMTP; без Redis/general/vault/rank/S3 capabilities |

Каждый Nest entrypoint передаёт явную process role в config loader, а system
worker использует отдельный минимальный loader. Лишний enable flag, adapter
credential или service token останавливает процесс. Service tokens должны
содержать `32..512` visible ASCII символов без whitespace/control/comma;
example placeholders и повторно используемые значения отклоняются. Internal
HTTP clients используют `redirect: "error"`, поэтому credential не следует за
redirect на другой origin.

## Подготовка ручного съёма позиций

Internal HTTP API создаёт ручной запуск через
`POST /internal/v1/workspaces/:workspaceId/projects/:projectId/rank-runs`,
возвращает его через project-scoped `GET .../jobs/:jobId` и принимает
cooperative cancel через `POST .../jobs/:jobId/cancel`. Caller передаёт
проверенный tenant/actor context и
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`; публичный
клиент обращается к этим маршрутам только через Platform API.

PostgreSQL является источником истины. До обращения к SEO Data сервис одной
транзакцией повторно сверяет ранее сохранённый immutable execution snapshot,
а затем сохраняет `PREPARING` Job, sidecar запуска, точную каноническую
manifest-команду и её hash. Перед каждым внешним HTTP command дополнительно
сверяется с tenant/job/estimate/project/context графом. В BullMQ
`rank-preparation` передаётся только `jobId`, поэтому секреты, keyword text и
execution evidence не попадают в Redis.

Первичная постановка в очередь выполняется best effort после commit.
Producer Redis не накапливает offline-команды и ограничивает connect/command
двумя секундами, поэтому недоступная очередь не удерживает уже принятую HTTP
команду бесконечно.
`rank-worker` периодически выбирает из PostgreSQL незавершённые подготовки с
истёкшими lease/retry deadline и идемпотентно восстанавливает потерянное
сообщение. После crash или неоднозначного ответа SEO Data worker повторяет
сохранённую exact-команду, а не строит её из изменившегося состояния. После
успешного seal он атомарно сохраняет receipt, создаёт по одному `JobItem` на
immutable chunk и переводит Job в `QUEUED`.

Cancel до первой попытки seal завершает Job без manifest. Если попытка уже
началась либо manifest точно создан, worker сначала восстанавливает исход
seal либо идемпотентно finalizes manifest в SEO Data, и лишь затем фиксирует
локальный terminal outcome. Неоднозначные/permanent ответы не записываются
как `NOT_SEALED`: после максимум 20 exact attempts они становятся terminal
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` для reconciliation оператором.
Retry delay и BullMQ delivery backoff используют bounded jitter. Cancel и
worker всегда блокируют строки в порядке `Job → RankJobRun`.
Bounded Platform API client проверяет exact grant request/scope hashes,
запрещает redirect и ограничивает timeout/размер ответа. Принятый grant
не разрешает provider call сам по себе. Dark service сначала под canonical
locks сохраняет в `rank_execution_grant_attempts` immutable exact
`REQUESTED` intent и лишь затем пересекает HTTP boundary. Retryable ambiguity
оставляет тот же intent для exact replay с прежними request и idempotency key;
ответ фиксируется как `DENIED`, `EXPIRED`, `GRANTED_PENDING_CONSUME` либо
`REJECTED_LOCAL`. Неистёкший `GRANTED_PENDING_CONSUME` под повторной
проверкой exact graph атомарно переходит в `CONSUMED` только вместе с
единственной secret-free `rank_connector_executions/READY_TO_SUBMIT`.
Connector credential material в эту row не копируется. Service credential
доступен только rank-worker, но dispatcher этот path пока не вызывает.
Entry point по-прежнему не вызывает Arsenkin и не включает live provider
submit: соответствующие release gates из ADR-2026-034 остаются обязательными.
Forward migrations `20260730101500_rank_connector_execution_claim`,
`20260730101700_rank_connector_submitting_enum` и
`20260730101800_rank_connector_submit_authorization` добавляют pre-network
`CLAIMED` lease и hardened `SECURITY DEFINER` claim/authorize boundary.
Candidate сначала non-locking проверяет весь current graph, затем блокирует
его в canonical порядке и возвращает только одну encrypted credential
projection. Versioned DB-control по умолчанию закрыт; использованные
kill-switch versions хранятся immutable и не могут быть активированы
повторно. `PUBLIC` execute отозван, а permission script выдаёт connector role
exact `EXECUTE` только на public claim и authorize functions. `CLAIMED` не
разрешает provider network bytes. Authorize повторно проверяет полный graph,
lease fence и ожидаемые execution/control versions, затем атомарно переводит
row в `SUBMITTING` и фиксирует durable may-have-started marker до возможного
network boundary. TypeScript runtime caller, provider request/status/result
producer и DB persistence для существующего pure lifecycle пока отсутствуют;
pure reducer без DB wrapper не является security boundary. Retryable submit
требует нового grant и monotonic execution attempt, а не повторного submit в
той же execution. Live provider submit остаётся выключенным.
Validation worker и KEK canary уже переведены на narrow
`SECURITY DEFINER` broker; connector role не имеет прямого `SELECT/UPDATE`
`jobs`, `integration_credentials` или canary table. Это закрывает global
vault read внутри `jobs_db`, но не отменяет оставшиеся rank provider lifecycle,
KMS/KEK, Redis ACL и фактические cluster/`pg_hba` release gates. Public history
API/UI уже готовы и в этот следующий шаг не входят.

Result producer в Jobs пока отсутствует. Поэтому текущие Jobs HTTP/workers,
включая rank-worker и connector-worker, не получают
`JOBS_TO_SEO_RANK_RESULT_TOKEN` или `RANK_HISTORY_CURSOR_KEY`; Compose требует
и передаёт оба значения только `seo-data`. Live Arsenkin `set` остаётся
fail-closed.

Локальный запуск:

- `pnpm dev:worker:rank` — watch-режим;
- `pnpm start:worker:rank` — запуск собранного
  `dist/rank-worker.main.js`.

### Окружение rank-worker

Общий `.env.example` показывает безопасный default
`RANK_PREPARATION_ENABLED=false`. Для rank-worker в Dokploy нужен отдельный
набор переменных:

- `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_URL`;
- `PLATFORM_API_URL`, `PLATFORM_API_COMMAND_TIMEOUT_MS`;
- `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` длиной не менее 32 символов,
  совпадающий только с issuer token в Platform API;
- `SEO_DATA_URL`, `SEO_DATA_COMMAND_TIMEOUT_MS`;
- `RANK_PREPARATION_ENABLED=true`;
- `JOBS_TO_SEO_RANK_TOKEN` длиной не менее 32 символов, совпадающий только с
  validator token в SEO Data;
- `RANK_PREPARATION_LEASE_SECONDS`,
  `RANK_PREPARATION_DISPATCH_SECONDS`,
  `RANK_PREPARATION_CONCURRENCY`;
- `INTEGRATION_CREDENTIAL_ROLE=DISABLED`.

Lease обязан превышать timeout команды SEO Data минимум на пять секунд.
Rank-worker не должен получать `PLATFORM_API_TO_JOBS_TOKEN`,
`JOBS_TO_SEO_DATA_TOKEN`, `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`,
`JOBS_TO_SEO_RANK_RESULT_TOKEN`,
`RANK_HISTORY_CURSOR_KEY`, credential keyrings, NATS credentials, S3 access
keys или SMTP credentials. `JOBS_TO_SEO_RANK_TOKEN`
также запрещён HTTP, generic, import, inspection и connector processes,
queue payload, логам и application data. Поэтому нельзя включать rank-worker
простым переключением флага в полном management-env: в Dokploy создаётся
отдельный deployment/command того же image с минимальным env allowlist.
Токен ротируется процедурой expand → switch caller → retire old, без
переиспользования generic или credential service secrets.

`JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` также запрещён Jobs HTTP, generic,
connector/import/inspection/system workers, migrations, queue payload, логам
и application data. Compose фиксирует `PLATFORM_API_URL` внутренним адресом
`http://platform-api:4000`, а timeout grant command по умолчанию равен пяти
секундам.

DB-backed проверка порядка блокировок запускается только на disposable
database с уже применёнными migrations:

`JOBS_RANK_TEST_DATABASE_URL=postgresql://... node --import tsx --test src/rank-runs/rank-job-lock.integration.test.ts`

Migrations `20260729230100_rank_execution_grant_attempts`,
`20260729230200_rank_connector_executions`,
`20260730101500_rank_connector_execution_claim`,
`20260730101700_rank_connector_submitting_enum` и
`20260730101800_rank_connector_submit_authorization` прошли PostgreSQL 18
fresh/upgrade rehearsal, exact non-owner permission proof и claim/authorize
race regression. Отдельными release gates остаются runtime wiring, provider
request/status/result и durable DB-backed lifecycle после `SUBMITTING`.

Миграция rank preparation fail-closed останавливается при legacy
`MANUAL_RANK_CHECK` без sidecar или конфликтующих active deduplication keys.
Она перестраивает unique index обычным DDL, поэтому для уже нагруженной базы
нужны worker drain и maintenance window; последующий large-database rollout
должен перейти на отдельный expand/concurrent-index план. PostgreSQL 18
fresh/negative/race rehearsal остаётся обязательным staging gate.

## Transactional auth-email worker

Worker принимает только три exact secret-free events из
`AUTH_EMAIL_EVENTS`, сохраняет одну `auth_email_delivery_attempts` row по
source event ID/type/canonical hash и перед SMTP получает JIT material из
Platform API. Recipient, plaintext token, action URL, subject и body в Jobs
DB/NATS/queue/logs не сохраняются. Stale/expired/consumed material даёт
terminal `CANCELLED`, retryable failure — bounded backoff, exhausted attempt
сначала остаётся `DLQ_PENDING` до подтверждённого redacted DLQ PubAck.

Source delivery at-least-once. После durable `SMTP_ACCEPTED` worker повторяет
только invite completion/local commit. Crash после SMTP accept, но до этой
записи может вызвать повтор со стабильным `Message-ID`; это best-effort
dedup, а не exactly-once. Hard recipient rejection сначала требует
подтверждённый redacted DLQ PubAck, затем идемпотентный Platform completion
`BOUNCED`, и только после этого допускает terminal local commit. DB login
`jobs_auth_email_runtime` получает только
`SELECT/INSERT/UPDATE` этой таблицы, general Jobs role — нет.

Production SMTP provider/sender/credentials отсутствуют в repository и
задаются оператором. Rollout: migration/role/NATS topology → Platform
JIT/publisher → canary worker. Rollback сохраняет stream, durable consumer,
outbox и attempts; ручной resend требует reconciliation неоднозначных
`SENDING` состояний.

Deploy передаёт worker только `AUTH_EMAIL_SMTP_*`; Compose маппит их в
process-local `SMTP_*`, которые читает config loader. Directus использует
отдельные `DIRECTUS_SMTP_*`; shared SMTP credentials запрещены. Readiness
marker создаётся только после bootstrap и удаляется до drain. Container
`stop_grace_period` должен быть строго больше worst-case bounded shutdown
budget, включая `AUTH_EMAIL_SHUTDOWN_GRACE_MS`.

## Адаптеры

- S3 multipart полностью конфигурируется через env и по умолчанию выключен;
- SMTP доступен только auth-email process и требует полной operator-managed
  конфигурации; при неполной worker fail-closed не стартует;
- disabled adapters позволяют поднять foundation без внешних credentials;
- включённый, но недоступный обязательный adapter виден в readiness.

## Multipart uploads

Внутренний API `/internal/v1/uploads` создаёт opaque project-scoped object
keys, выдаёт короткоживущие signed URLs на отдельные parts, проверяет полный
набор ETag и фактический размер объекта при завершении. Все команды привязаны
к проверенным `workspaceId`, `projectId`, `actorId`; создание идемпотентно.

Статус `UPLOADED` ещё не разрешает импорт: следующий worker обязан потоково
вычислить SHA-256, проверить MIME по содержимому и malware scan, после чего
перевести объект в `READY` либо `REJECTED`.

## Импорт XLSX и нативного Key Collector

`import-worker` поддерживает CSV/TSV, XLSX Key Collector и нативный `.kc4`.
KC4 проходит signature/central-directory/zip-bomb проверки, извлекает только
`main.tkc4` в mode-600 temp file и читает SQLite только в read-only/query-only
режиме. Корзина Key Collector исключается, а отдельный group manifest
сохраняет пустые папки; дубли одной фразы объединяют все group memberships.

XLSX сначала
потоково копируется в mode-600 temporary file с лимитом 256 МиБ, затем
`unzipper-esm` читает central directory и только allowlisted OpenXML entries,
а `saxes` потоково разбирает XML. Это позволяет обработать shared strings,
cached formula values, даты и первый видимый worksheet без загрузки workbook
целиком в память. Encrypted archive, duplicate/missing metadata, DTD,
небезопасный relationship, более 10 000 entries, excessive compression ratio,
uncompressed size, columns/field/row и shared-string budget отклоняются
terminal-кодом.

Новые production-зависимости ограничены parser worker:
`unzipper-esm@0.13.3` даёт random-access entry streams без extraction на
filesystem, `saxes@6.0.0` — namespace-safe streaming XML parser. Они заменили
`exceljs`, чей production dependency tree содержал известные advisories.
`pnpm audit --prod` после lockfile overrides не содержит известных
уязвимостей. `fflate` используется только тестом/smoke для генерации
детерминированного XLSX fixture.

## Проверка BYOK credentials

HTTP-процесс запускается с `INTEGRATION_CREDENTIAL_ROLE=MANAGEMENT`: он
создаёт и ротирует envelope-encrypted secrets, поэтому получает KEK,
независимый fingerprint keyring и dedicated internal token.
`connector-worker` запускается с ролью `EXECUTION` и получает только KEK для
расшифровки. Конфигурация fail-closed отклоняет fingerprint keys и management
token у execution worker. До создания Redis/BullMQ worker он через broker
передаёт все configured KEK versions (максимум 128) и получает synthetic
authenticated canaries для их объединения с versions, реально используемыми
неудалёнными credentials, плюс явный usage marker. Поэтому ещё не active KEK
проверяется на каждой replica до переключения, used-but-unconfigured version
fail-closed обнаруживается, а retired unused historical canary не требует
старого ключа. Missing canary возвращается nullable строкой и вместе с
corrupt/wrong-key envelope останавливает startup. Canary не содержит tenant/
provider/credential identity, создаётся management process один раз для каждой
настроенной KEK version и затем immutable; повторная регистрация возвращает
исходный envelope. Пустой vault допустим. Management process отдельно
сохраняет fingerprint coverage.

Очередь по-прежнему содержит только `jobId`. Dispatcher получает через broker
только due validation IDs. Claim принимает точный validation ID и выдаёт
random lease token, owner/version fence, безопасный summary и encrypted
material только при совпавших workspace/provider/material/state. Arbitrary и
не-validation UUID не раскрывают строки. Success и provider failure атомарно
обновляют Job/credential; stale lease, token, version или material не могут
применить результат, а decrypt/KEK/internal failures меняют только Job.

Arsenkin Tools и Keys.so проверяются асинхронно через документированные
read-only account/limits endpoints. PostgreSQL `Job` — источник истины,
BullMQ содержит только `jobId`; dispatcher восстанавливает потерянную очередь.
Job фиксирует `materialVersion`, поэтому результат старой проверки после
ротации не может активировать новый secret. Успешная внешняя проверка
обновляет сохранённый capability snapshot текущим provider allowlist; новую
capability старый ключ получает только после revalidation. XMLStock проверяет
пару `USER ID + KEY` read-only запросом Wordstat `pagetype=regionsTree`, после
чего credential может обслуживать `WORDSTAT` и `SERP_RANK_TRACKING`.

XMLStock rank runtime выполняет Yandex XML асинхронно (`delayed=1`, opaque
`req_id`, poll 15/25 секунд) и Google XML постранично по 10 результатов.
Каждый manifest chunk содержит один keyword; TOP-30/50/100 нормализуется в
абсолютную позицию и релевантный URL без сохранения raw XML. Wordstat остаётся
синхронным per-keyword/per-type контрактом BASE/EXACT/FIXED: provider
`groupby` управляет числом фраз ответа и не является batch входных keywords.

## Проектные привязки connectors

Внутренний project-scoped API
`/internal/v1/workspaces/:workspaceId/projects/:projectId/integration-settings`
возвращает нормализованный aggregate, создаёт одну привязку на
`workspace + project + capability` и изменяет её по
`.../integration-settings/:bindingId`. Route, trusted headers и command body
должны содержать один и тот же workspace/project/actor context; используется
тот же отдельный credential API token, что и для vault.

Первый срез поддерживает только один route с `position=0`,
`sourceKind=WORKSPACE_CREDENTIAL` и активным `BYOK_API_KEY`. Credential обязан
принадлежать workspace, не быть удалённым и предоставлять capability,
сохранённую одновременно в credential и текущем provider catalog. Platform
credentials, fallback и binding budgets возвращают
`FEATURE_NOT_AVAILABLE`; их нельзя имитировать пустыми обещаниями.

Создание хранит immutable receipt с 32-byte request hash и исходным response
snapshot. Точный повтор после PATCH возвращает первоначальный create response,
другой payload с тем же ключом — `IDEMPOTENCY_CONFLICT`. PATCH использует CAS;
stale version возвращает HTTP 412 `VERSION_CONFLICT` с безопасным
`currentVersion`. Привязки не удаляются: отключение — `enabled=false`, причём
сломанное credential не мешает отключить текущий route.

Binding, route, create receipt и redacted outbox event записываются одной
транзакцией. Outbox payload не содержит credential ID, label, display hint,
provider metadata или secret fields, использует общий contract и содержит
только allowlisted `changedFields`. GET сохраняет недоступные bindings с
явным availability, а credential options содержит только безопасную проекцию
неудалённых workspace credentials. Aggregate ограничен 500 options,
выставляет `credentialOptionsTruncated` и всегда сохраняет в bounded выдаче
credentials текущих bindings. Capabilities всегда являются пересечением
сохранённого JSON и текущего provider catalog; malformed JSON fail-closed
даёт пустой набор. Aggregate читает bindings и credential options из одного
`REPEATABLE READ` snapshot. Создание, включение и смена route удерживают
tenant-scoped `FOR SHARE` lock на credential до commit, но отключение
неизменённого inactive route не требует доступного credential. Ни один из
этих запросов не выбирает vault material.

Migration нормализует старую pre-release `integration_bindings` только при
пустой таблице. При наличии строк deploy останавливается: для такого
окружения нужен отдельный expand → backfill → validate → contract план,
удалять данные ради прохождения migration запрещено. Перед проверкой пустоты
legacy-таблица блокируется в `ACCESS EXCLUSIVE`, поэтому конкурентная запись
не может попасть между precondition и `DROP TABLE`.
