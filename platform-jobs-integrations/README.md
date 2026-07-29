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
  `EXECUTION`-ролью credential vault.

Worker entrypoints разделяются по профилю нагрузки и набору секретов, а не по
каждой операции.

## Подготовка ручного съёма позиций

Internal HTTP API создаёт ручной запуск через
`POST /internal/v1/workspaces/:workspaceId/projects/:projectId/rank-runs`,
возвращает его через project-scoped `GET .../jobs/:jobId` и принимает
cooperative cancel через `POST .../jobs/:jobId/cancel`. Caller передаёт
проверенный tenant/actor context и dedicated credential API token; публичный
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
Этот entrypoint пока не вызывает Arsenkin и не включает live provider
submit: соответствующие release gates из ADR-2026-034 остаются обязательными.
Следующий связный runtime-путь — authoritative execution grant → scoped
connector boundary → provider submit/status → normalized result producer с
сохранением ingest receipts. Public history API/UI уже готовы и не входят в
этот следующий шаг.

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
- `SEO_DATA_URL`, `SEO_DATA_COMMAND_TIMEOUT_MS`;
- `RANK_PREPARATION_ENABLED=true`;
- `JOBS_TO_SEO_RANK_TOKEN` длиной не менее 32 символов, совпадающий только с
  validator token в SEO Data;
- `RANK_PREPARATION_LEASE_SECONDS`,
  `RANK_PREPARATION_DISPATCH_SECONDS`,
  `RANK_PREPARATION_CONCURRENCY`;
- `INTEGRATION_CREDENTIAL_ROLE=DISABLED`.

Lease обязан превышать timeout команды SEO Data минимум на пять секунд.
Rank-worker не должен получать `INTERNAL_API_TOKEN`,
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`, `JOBS_TO_SEO_RANK_RESULT_TOKEN`,
`RANK_HISTORY_CURSOR_KEY`, credential keyrings, NATS credentials, S3 access
keys или SMTP credentials. `JOBS_TO_SEO_RANK_TOKEN`
также запрещён HTTP, generic, import, inspection и connector processes,
queue payload, логам и application data. Поэтому нельзя включать rank-worker
простым переключением флага в полном management-env: в Dokploy создаётся
отдельный deployment/command того же image с минимальным env allowlist.
Токен ротируется процедурой expand → switch caller → retire old, без
переиспользования generic или credential service secrets.

DB-backed проверка порядка блокировок запускается только на disposable
database с уже применёнными migrations:

`JOBS_RANK_TEST_DATABASE_URL=postgresql://... node --import tsx --test src/rank-runs/rank-job-lock.integration.test.ts`

Миграция rank preparation fail-closed останавливается при legacy
`MANUAL_RANK_CHECK` без sidecar или конфликтующих active deduplication keys.
Она перестраивает unique index обычным DDL, поэтому для уже нагруженной базы
нужны worker drain и maintenance window; последующий large-database rollout
должен перейти на отдельный expand/concurrent-index план. PostgreSQL 18
fresh/negative/race rehearsal остаётся обязательным staging gate.

## Адаптеры

- S3 multipart полностью конфигурируется через env и по умолчанию выключен;
- SMTP transactional email полностью конфигурируется через env и по умолчанию выключен;
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

## Проверка BYOK credentials

HTTP-процесс запускается с `INTEGRATION_CREDENTIAL_ROLE=MANAGEMENT`: он
создаёт и ротирует envelope-encrypted secrets, поэтому получает KEK,
независимый fingerprint keyring и dedicated internal token.
`connector-worker` запускается с ролью `EXECUTION` и получает только KEK для
расшифровки. Конфигурация fail-closed отклоняет fingerprint keys и management
token у execution worker.

Arsenkin Tools и Keys.so проверяются асинхронно через документированные
read-only account/limits endpoints. PostgreSQL `Job` — источник истины,
BullMQ содержит только `jobId`; dispatcher восстанавливает потерянную очередь.
Job фиксирует `materialVersion`, поэтому результат старой проверки после
ротации не может активировать новый secret. Успешная внешняя проверка
обновляет сохранённый capability snapshot текущим provider allowlist; новую
capability старый ключ получает только после revalidation. XMLStock остаётся
`PENDING_VERIFICATION`, пока провайдер не предоставит подтверждённый
неоплачиваемый validation endpoint и test fixtures.

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
