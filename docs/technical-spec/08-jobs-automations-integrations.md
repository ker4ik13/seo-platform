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

### 2.1. Маршрутизация интеграций

Секретный credential всегда принадлежит workspace. Для каждой capability
workspace хранит единственную упорядоченную цепочку credentials. Пользовательский
project override отсутствует: все проекты рабочей области исполняют один
workspace route. Сохранённые ранее project bindings остаются только внутренней
immutable ссылочной проекцией для execution history; перед новым запуском
resolver переводит её в `WORKSPACE_INHERITED` и materialize-ит актуальную
workspace chain.

Resolver сохраняет в operation snapshot фактический provider, routing scope и
последовательность попыток. Каждая попытка содержит только provider, scope,
outcome и нормализованный reason code; credential/route ID и secret наружу не
выдаются. Разрешённые причины перехода задаются владельцем маршрута из
`CREDENTIAL_UNAVAILABLE`, `LOW_BALANCE`, `RATE_LIMITED`,
`RETRYABLE_PROVIDER_ERROR`. Последняя причина применяется только к уже
зафиксированному безопасному состоянию `DEGRADED` до нового submit. Неизвестная ошибка или
неоднозначный результат после внешнего submit не запускают другой provider:
операция переходит в retry/action-required согласно connector contract, чтобы
не допустить повторную платную команду.

Настройка основного маршрута требует `integration.update`, а нескольких routes
или fallback — `integration.manage_fallback`. Порядок routes меняется явно и
определяет основной и резервные providers. Если credential подключён, но не
включён в route нужной capability, мастер операции не предлагает его как
исполняемый и ведёт пользователя в `/app/settings/integrations`.
Новый credential атомарно добавляется последним во все совместимые workspace
routes, не меняя выбранный основной источник. При появлении второго источника
цепочка включает `NEXT_AVAILABLE` со штатными безопасными причинами fallback.
Одноразовая migration владельца Jobs backfill-ит такие routes для подключений,
созданных до введения этого правила; connector-worker по-прежнему не получает
прямого чтения credential и routing tables.
Выбор credential в каждом provider-backed operation dialog передаётся как
exact `provider + credentialId` через public/internal contracts, paid quote
(если нужен) и Jobs resolver. Это относится к позициям и конкурентной SERP,
ИИ-ответам и ИИ-выдаче, обычной частотности и сезонности, кластеризации,
парсингу Wordstat и Keys.so. Показанная в UI стоимость поэтому относится к
тому же route, который записывается в Job и исполняется worker-ом; при
нескольких аккаунтах backend не может скрыто вернуться к первому аккаунту
цепочки.
Явно выбранный credential всегда является первой попыткой конкретного запуска.
При разрешённом pre-submit fallback resolver затем обходит всю сохранённую
workspace chain по порядку, исключая уже выбранный credential и providers,
которые не могут сохранить семантику операции; его исходная позиция в цепочке
не может скрыто вернуть запуск на route `0`.
`ACTION_REQUIRED/CONNECTOR_NOT_READY` возникает до provider I/O и поэтому
получает действие «Продолжить»: оно version-aware переоткрывает тот же Job и
его PENDING items после исправления route, не создавая повторного платного
submit. Неоднозначные provider outcomes по-прежнему не возобновляются.
Денежный баланс, rate limit и временная provider-недоступность не являются
условиями сохранения, включения или перестановки статически совместимого
workspace route. Они повторно проверяются только при подготовке операции. При
создании XMLStock Wordstat operation resolver получает точное максимальное число
обращений, сравнивает стоимость всего запуска по последнему проверенному тарифу
с балансом каждого BYOK credential и применяет `LOW_BALANCE` fallback до
создания immutable Job. Нулевой `requestLimit` тарифного аккаунта не считается
лимитом фраз: для такого аккаунта источником доступности служит денежный баланс.

## 3. Статусы Job

- `DRAFT`;
- `ESTIMATING`;
- `AWAITING_APPROVAL`;
- `RESERVING_BALANCE`;
- `PREPARING`;
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
- `ACTION_REQUIRED`;
- `EXPIRED`.

Статус и stage различаются: `RUNNING` может иметь stages `FETCHING`, `PARSING`, `SAVING`, `AGGREGATING`.

Для первого manual rank slice `PREPARING/PREPARING_SCOPE` означает
подготовку immutable scope до provider submit. Terminal
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` означает, что автоматическое
продолжение небезопасно: система не доказывает отсутствие side effect и
требует операторского или пользовательского решения. Этот status не должен
автоматически возвращаться в active lifecycle. В текущем срезе
reconcile/acknowledge API, admin/public UI и политика безопасного нового
запуска ещё не реализованы; terminal row остаётся доступным для чтения и
операторской диагностики.

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
- Cancel требует tenant/project scope и `collector.cancel`, но не ownership
  по `actorId`: уполномоченный участник команды может остановить чужой Job
  проекта.
- `CANCEL_REQUESTED` и `CANCELLED` обрабатываются как idempotent replay;
  другой terminal status возвращается без перезаписи.
- Остановка частотности не зависит от сохранённой в браузере версии Job:
  публичная команда имеет пустое тело, а Execution под tenant/project scope
  атомарно переводит только текущее cancellable-состояние. Поэтому обновление
  прогресса между открытием подтверждения и отправкой команды не создаёт
  ложный `VERSION_CONFLICT`.
- Для ручного съёма позиций `FINALIZING` является точкой невозврата: Web не
  предлагает остановку на этой стадии или после `CANCEL_REQUESTED`, а
  конкурентный переход в `FINALIZING` возвращается как authoritative replay
  без ошибки состояния.
- Cancel разрешён при billing read-only и для архивного проекта, поскольку
  уменьшает будущую работу; новые submit при этом остаются запрещены.
- UI не отправляет cancel по первому нажатию: для частотности и проверки
  позиций карточка операции и header результата открывают warning-modal с
  явным подтверждением. Default focus стоит на продолжении сбора.

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

Подготовка первого manual rank Job имеет отдельный bounded budget:
`maxAttempts=20`. Временная недоступность seal/finalize повторяется только до
этой границы; после исчерпания Job завершается как
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`, а не остаётся в бесконечном hot
retry.

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
- `rank-preparation`;
- `rank-connector-runtime`;
- `frequency-collection-runtime`;
- `keyword-research-runtime`;
- `public-toolbox`;
- `maintenance`.

Workers разделяются по профилю ресурсов:

- IO-bound;
- CPU-bound;
- browser-rendering;
- large-memory;
- report-rendering.

Manual rank job дополнительно разделяет process capabilities внутри одного
`backend-execution` image:

- выделенный rank worker без KEK управляет текущими preparation/recovery/
  cancellation-finalize стадиями; fairness, normalized persistence и
  provider execution добавляются следующими срезами;
- connector worker с execution KEK выполняет только allowlisted provider
  calls и строгую нормализацию. Rank, frequency, keyword research и credential
  validation используют независимые BullMQ queues и concurrency limits, чтобы
  длинный workload одного типа не блокировал остальные.

Это не новый сервис. Текущий `rank-worker.main.ts` получает PostgreSQL/Redis
и только выделенный `JOBS_TO_SEO_RANK_TOKEN`; generic HTTP, connector,
import, inspection и system workers этот token не получают. BullMQ payload
содержит только `jobId`, а PostgreSQL dispatcher восстанавливает потерянную
постановку и просроченные lease. До live rank submit connector role должен
получать scoped execution через SECURITY DEFINER operations, а не global read
Job и credential tables.

Реализованный config/Compose дополнительно фиксирует полный process matrix
одного Jobs image:

- HTTP: Jobs DB, Redis, NATS, S3, general Platform API/SEO Data tokens,
  credential-management token и keyrings;
- import worker: Jobs DB, Redis, S3 и `JOBS_TO_SEO_DATA_TOKEN` для SEO Data;
- inspection worker: Jobs DB, Redis, S3 и malware scanner;
- system worker: только Redis и bounded concurrency, без DB, NATS, S3, SMTP,
  malware, service tokens и credential material;
- rank worker: отдельный least-privilege `jobs_rank_runtime`, Redis,
  `JOBS_TO_SEO_RANK_TOKEN` и
  `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`, без general/management/adapters;
- connector worker: `jobs_connector`, Redis и execution KEK, без
  general/management/NATS/S3/SMTP credentials;
- auth-email worker: отдельный `jobs_auth_email_runtime`, dedicated NATS
  consumer и Platform JIT token, SMTP и outbound; без Redis, general/vault/
  rank/S3/malware capabilities.

Nest entrypoints передают явную process role в config loader, system worker
использует отдельный Redis-only loader. Чужой enable flag, service token или
adapter credential останавливает процесс fail-closed. Эта env boundary не
заменяет DB grants, Redis ACL, egress policy и runtime provider gates.

Rate limiting настраивается по provider, credential и provider product. Нельзя
полагаться только на общий limiter очереди; connector поддерживает
распределённые Redis quota buckets. XMLStock разделяет `YANDEX_LIVE`,
`GOOGLE_LIVE`, `YANDEX_SEARCH_API` и `WORDSTAT`; разные credentials никогда не
делят bucket, а один credential делит его между своими проектами и всеми
replicas. Permit удерживается только вокруг фактического provider HTTP, не во
время `POLL_WAIT` или внутренних операций. Throttling включает bounded
adaptive cooldown, успешные ответы постепенно восстанавливают окно, а
недоступный limiter блокирует внешний вызов fail-closed. Начальные окна на
один credential: Yandex Live — `20 concurrent / 15 RPS`, Google Live —
`48 / 30`, Yandex Search API — `50 / 50`, Wordstat — `10 / 20`; provider
ответы `55`, `110`, `429` и `503` уменьшают только соответствующее окно.
Distributed 100-ms smoothing не даёт нескольким replicas выбрать весь
секундный budget одним burst; короткий permit wait остаётся внутри текущего
lease, а длинное ожидание возвращается обычному fenced scheduler.

Rank и connector process roles разрешено горизонтально размножать внутри
одного `backend-execution` container supervisor. PostgreSQL остаётся source of
truth, lease/token/version fencing предотвращает двойное выполнение, а
Arsenkin provider-task capacity считается глобально между rank и frequency.
Штатный default — один rank coordinator. Connector consumers остаются в трёх
процессах. Periodic SQL maintenance, credential refresh discovery и
maintenance queue dispatch выполняет только первый process instance. Runtime
tick dispatch выполняют все экземпляры через непересекающиеся deterministic
shard sequence, поэтому BullMQ deduplication не схлопывает три configured пула
в один. Это убирает одинаковые фоновые сканы и сохраняет полные 48
provider-I/O slot.
При `CONNECTOR_PAID_RUNTIME_ENABLED=false` процесс продолжает credential
validation/refresh, но не создаёт BullMQ consumers и ticks для rank,
frequency, keyword research, AI answers и clustering. Режим предназначен для
безопасной визуальной проверки production-копии; production default — `true`.
XMLStock HTTP capacity считается независимо для каждого credential/product;
PostgreSQL claim order предпочитает credential/project pair с меньшим числом
активных leases и использует oldest-first как tie-breaker. Frequency claim
после каждого serviced item перемещается за другие due Jobs того же priority.
Runtime dispatcher запускается раз в секунду, поэтому свободные workers не
ждут пятнадцатисекундный maintenance tick. Истёкшая до первого provider byte
авторизация безопасно заменяется новым execution attempt; после начала submit
автоматический повтор по-прежнему запрещён. Advisory lock сериализует только
короткую Arsenkin capacity-check/claim транзакцию: ожидающие
connector-процессы за один queue burst заполняют свободные provider slots, а
provider HTTP выполняется параллельно уже вне этой блокировки. XMLStock
capacity miss возвращает poll/item в ожидание без списания attempt.
XMLStock не участвует в общей DB capacity из пяти provider tasks: rank
dispatcher подготавливает до 48 keyword executions одного Job за проход,
чтобы заполнить три connector process по 16 rank workers. Общая DB capacity
из пяти задач остаётся Arsenkin-only; один XMLStock credential всё равно
строго ограничен своим Redis product bucket.

Все Arsenkin submit-пути используют одну lock identity
`seo-platform:rank-dispatch:ARSENKIN`. Это включает rank/check-top, Wordstat,
ИИ-ответы, кластеризацию и keyword research. Принятый provider task может
вернуться из `check` в `queue|queued|wait|waiting|pending`; такой ответ не
является ошибкой и продолжает bounded polling без повторного submit.
Нормализованные `STAGED` rank-results сохраняются отдельным секундным bounded
dispatcher. Короткий PostgreSQL claim сначала выравнивает число активных
persistence leases между workspace, затем между Job одного workspace и только
после этого выбирает oldest chunk внутри Job; крупный старый съём поэтому не
может скрыто удерживать весь ingest новых съёмов.
Finalization рассматривает только
последнюю execution attempt каждого manifest chunk; предыдущие безопасно
прерванные attempts остаются immutable audit history и не меняют cardinality
Job.

XMLStock Live Top-30/50/100 выполняется по одной десятистрочной странице за
poll. После каждого успешного ответа connector атомарно сохраняет
нормализованный checkpoint и SHA-256 в `rank_connector_executions`; 429/5xx
возвращает execution в `POLL_WAIT`, не удаляя checkpoint. Следующий worker
проверяет hash и продолжает с `nextPage`; успешный checkpoint доступен для
следующего claim сразу, без искусственной пятисекундной паузы, а distributed
limiter ограничивает фактический GET. Поэтому уже оплаченные страницы не
запрашиваются повторно. Permanent ошибки и исчерпание bounded poll horizon
по-прежнему финализируются, а не уходят в бесконечный цикл.

Для безопасно финализированного `PARTIALLY_COMPLETED` manual rank Job без
`SUBMIT_OUTCOME_UNKNOWN` доступен manual `retry-missing`. Jobs создаёт
immutable child с `parentJobId`, а SEO Data выбирает недостающие entries из
родительского `CLOSED` manifest по отсутствию `rankSnapshot` и повторно
сверяет current project/context/configuration и тексты ключей. Для child Jobs
создаёт новый immutable estimate с `keywordCount`, provider workload и
request counts, рассчитанными только для остатка, а credential proof обновляет
только при неизменном binding/route/credential material. Один parent может
иметь только один прямой child; дальнейший partial outcome продолжается от уже
нового child.

### 8.1. Transactional auth-email worker

Отдельный `auth-email-worker.main.ts` обрабатывает только три secret-free
source events из `AUTH_EMAIL_EVENTS`: email verification, password reset и
workspace invite. Он не является общей notification/digest очередью.

PostgreSQL `auth_email_delivery_attempts` является источником истины для
delivery lifecycle:

- unique source event ID плюс immutable event type/canonical SHA-256 не дают
  reuse одного ID с другим payload;
- recipient, plaintext token, action URL, subject и body не сохраняются;
- versioned CAS, lease и DB clock защищают повторный claim/recovery;
- retryable failure получает bounded exponential backoff с deterministic
  jitter; terminal invalid material отменяется без SMTP;
- exhausted attempt остаётся `DLQ_PENDING`, пока redacted DLQ PubAck не
  подтверждён;
- hard recipient rejection только после подтверждённого DLQ PubAck вызывает
  идемпотентный Platform completion `BOUNCED` до terminal local commit;
- source ack разрешён после durable local outcome, а graceful shutdown
  оставляет незавершённый source доступным для redelivery.

Перед каждой первой SMTP-отправкой worker получает JIT material из Platform
API по dedicated credential. После durable `SMTP_ACCEPTED` повторяет только
invite completion/local finalization, но не SMTP. Сохраняется только bounded
provider message ID. Crash после SMTP accept и до записи `SMTP_ACCEPTED`
остаётся неоднозначным и может дать повтор после lease expiry. Stable
`Message-ID` является best-effort dedup hint, а не exactly-once гарантией.

DB login `jobs_auth_email_runtime` имеет только `SELECT/INSERT/UPDATE`
`auth_email_delivery_attempts`; general Jobs runtime не имеет доступа к этой
таблице. Worker не получает Redis, поэтому recovery выполняется bounded scan
PostgreSQL, а не queue payload.

На deploy boundary worker получает только `AUTH_EMAIL_SMTP_*`, которые
маппятся в его process-local `SMTP_*`; общий SMTP credential set с другими
process boundaries запрещён. Readiness marker
создаётся после bootstrap и удаляется до drain, а container
`stop_grace_period` обязан быть строго больше worst-case bounded shutdown
budget, включая `AUTH_EMAIL_SHUTDOWN_GRACE_MS`.

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
- delayed one-time schedule;
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
- Rank schedule `ONCE` использует один stable delayed BullMQ job, а не cron.
  PostgreSQL Automation остаётся source of truth: schedule run и переход в
  `ONE_TIME_COMPLETED` создаются одной транзакцией, поэтому reconciliation не
  может поставить одноразовое задание второй раз. Изменённая future-дата
  заменяет ещё не начавшийся delayed job; active delivery не удаляется.
- Rank schedule хранит `maxPlatformChargeMicro` как явный per-run budget.
  Значение `0` разрешает только BYOK. Каждый scheduled/manual occurrence после
  PostgreSQL claim вызывает Core через scoped automation token; Core заново
  проверяет actor RBAC, tenant lifecycle, entitlement, quota, capacity и
  trusted price book, создаёт fresh estimate и запускает обычный RankRun только
  если точная цена не превышает cap. В Jobs не хранится цена как authority и
  scheduler не списывает токены напрямую.
- Rank schedule не хранит пользовательский `maxItems` и не обрезает контекст:
  каждый запуск берёт все актуальные ключи выбранного tracking context. После
  tenant/RBAC/entitlement recheck и до fresh estimate Core вызывает trusted
  SEO Data materializer: `ALL/GROUPS` заново разрешаются из активных запросов и
  дерева папок, а `isTracked=false` исключается, если профиль не разрешает
  `includeUntracked`. Scheduled и ручной automation-run поэтому не используют
  сохранённое браузером число запросов.
  Provider/plan capacity по-прежнему проверяется estimate-ом и исполняется
  штатными chunk/batch-механизмами без скрытого сокращения scope.
- DELETE rank schedule требует CAS, атомарно выключает definition и ставит
  `deleted_at`, после commit удаляет BullMQ scheduler. Исторические runs и Jobs
  остаются связанными с soft-deleted Automation.
- `AutomationCapacityEntitlement.scheduledAutomations` ограничивает только
  суммарное число включённых rank/crawl-расписаний workspace. Счётчик вида
  «N из M активных расписаний» не является лимитом ключей.
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

Workspace-маршруты сохраняются сразу после изменения элемента цепочки. При
добавлении нового credential клиент сохраняет уже настроенные временно
недоступные routes; их удаление остаётся отдельным явным действием. Runtime
availability не блокирует изменение порядка и не превращает route settings в
execution grant. Обычный сбор частотности (`WORDSTAT`) и расширение
семантики через Wordstat (`KEYWORD_RESEARCH`) подписаны разными названиями,
чтобы пользователь настраивал требуемую операцию явно.

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
Arsenkin Tools и Keys.so и асинхронную read-only проверку ключей всех трёх
провайдеров:

- Platform API повторно проверяет active session lifecycle, CSRF и workspace
  permission. Browser API автоматически делает единственную refresh rotation
  при истёкшем access token; create/update/validate/revoke credential не
  требуют отдельного интерактивного повторного входа;
- vault endpoints принимают отдельный service token, доступный только
  Platform API и management-role jobs HTTP process;
  `PLATFORM_API_TO_JOBS_TOKEN` и остальные general audience credentials эту
  границу не открывают;
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
- пользовательский credential DTO содержит только нормализованную безопасную
  квоту последней успешной проверки: остаток внутренних лимитов Arsenkin либо
  `limit/used/remaining` API-запросов Keys.so. Сырой `providerMeta`, ответы
  провайдера и любые неизвестные поля не пересекают сервисную границу;
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
   `INTEGRATION_CREDENTIAL_ROLE=EXECUTION` получает due ID и забирает lease
   только через allowlisted `SECURITY DEFINER` broker. Lease связан с exact
   Job, owner, случайным token, Job version и DB deadline.
4. Broker повторно проверяет workspace, provider, credential state, material
   version и зафиксированную connector version и возвращает encrypted material
   только для `READY`; arbitrary/другой Job UUID не создаёт existence oracle.
   Worker только затем расшифровывает секрет.
5. Arsenkin вызывает фиксированный
   `https://arsenkin.ru/api/tools/info`, Keys.so —
   `https://api.keys.so/limits/all`, XMLStock — только read-only account API
   `https://xmlstock.com/api/` в базовом режиме, с `info=user` и
   `info=status`, используя обязательные `USER ID + KEY`. Проверка не вызывает
   SERP/Wordstat endpoints и не списывает платные запросы; пользователь не
   может изменить origin, URL, method или headers.
6. Provider request имеет timeout, `redirect: error` и ограничивает фактически
   прочитанный body одним MiB. Успешный `2xx` обязан быть валидным JSON;
   безопасный HTTP status и `Retry-After` неуспешного ответа классифицируются
   даже при пустом/non-JSON body. Наружу возвращаются только нормализованные
   status/error code и allowlisted account metadata.
7. Три finish-функции принимают только действующие owner/token/version/lease.
   Success и нормализованный provider failure атомарно блокируют Job, затем
   exact tenant credential и применяют результат только при прежнем
   `material_version`; rotate/revoke во время проверки даёт `STALE` и не
   изменяет новый credential material. Missing KEK, decrypt и internal errors
   проходят отдельный job-only finish и не меняют credential.
8. Retryable network/5xx/429 переводится в `RETRY_SCHEDULED`; `retryAt`
   учитывает bounded `Retry-After`, а periodic dispatcher восстанавливает
   пропущенные queue messages и просроченные leases. Его lease/retry indexes
   начинаются с `job.type`, чтобы typed dispatcher не сканировал jobs других
   типов. Для уже успешно проверенного Arsenkin credential такой временный
   результат фоновой revalidation не снимает `ACTIVE`: Job и `last_error_*`
   сохраняют наблюдаемую ошибку и backoff, а новые операции продолжают
   использовать обычный provider capacity limiter. Ранее записанный
   `RATE_LIMITED` и `DEGRADED + PROVIDER_UNAVAILABLE` этого credential
   восстанавливается в `ACTIVE`. Ошибка авторизации и постоянный
   `PROVIDER_PLAN_OR_REQUEST_REJECTED` остаются блокирующими.

Публичные validation states: `QUEUED`, `RUNNING`, `RETRY_SCHEDULED`,
`SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `STALE`. Terminal states —
`SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `STALE`; UI продолжает poll
для `RETRY_SCHEDULED` с учётом `retryAt`. GET результата требует
`integration.view` и должен работать в billing read-only режиме, POST требует
`integration.test` и блокируется, когда новые операции запрещены.
В platform operations `FAILED_RETRYABLE` проверки credential после исчерпания
`maxAttempts` относится к attention, а не active: у Job уже есть
`finished_at`, `retry_at = NULL`, и UI показывает «Повторы исчерпаны». Это
правило type-aware и не меняет lifecycle других Job types, где одноимённый
статус может ещё входить в provider-specific recovery.

Credential list может содержать опциональный `activeValidation`, но только
для текущего `material_version`. Запрос фильтрует active statuses и stable
deduplication keys всех видимых credentials; partial unique ограничивает
результат одной job на credential, поэтому history не вычитывается в память.
Web гидратирует эту job после reload/navigation и продолжает только GET poll.
Если конкурентный участник создал job между list и POST, клиент после `409`
обязан перечитать authoritative list и присоединиться к найденной active job;
если она уже terminal, используются обновлённые credential status и безопасный
`lastErrorCode`. `sessionStorage` не является источником истины validation.
Автоматическое возобновление browser polling ограничено десятью минутами от
`requestedAt`: более старая незавершённая job показывается как зависшая без
spinner и не удерживает локальный operation lock. Открытие revoke во время
свежего polling прерывает browser GET loop, освобождает lock и разрешает
`DELETE`; server revoke остаётся источником истины и делает исполняющуюся
старую проверку `STALE` через material/lifecycle guard.
Если последняя безопасная quota-проекция XMLStock уже показывает нулевой
денежный баланс, Web не присоединяется автоматически к validation job и не
держит бесконечный spinner. Backend при этом обновляет XMLStock, Arsenkin и
Keys.so через durable deduplicated job не чаще одного раза в час, в том числе
после provider operation: отдельные batch/items большого запуска не создают
непрерывную цепочку проверок. Ручная кнопка не использует этот TTL и запускает
одну явно запрошенную бесплатную проверку сразу. Поэтому баланс после пополнения обновляется без повторного
ввода ключа, а открытая modal не создаёт секундный polling/account-request
цикл. Сохранённые операции и результаты от revalidation не меняются.

`PENDING_VERIFICATION` не разрешает SEO jobs использовать credential.
XMLStock/Arsenkin/Keys.so переходят в `ACTIVE` только после реального provider
response.
Успешная проверка заменяет сохранённый список capabilities текущим allowlist
provider catalog. Новая документированная возможность поэтому становится
доступна существующему credential только после повторной внешней проверки, а
удалённая возможность сразу отсекается пересечением с каталогом.
Для Arsenkin validation-broker после каждой успешной проверки сохраняет ровно
`SERP_RANK_TRACKING`, `SERP_COLLECTION`, `WORDSTAT` и `CLUSTERING`; повторная
проверка ключа не должна отключать маршруты ИИ-ответов `ai-serp` и
кластеризации. Миграционный guard добавляет документированные `WORDSTAT` и
`CLUSTERING` существующим активным проверенным credentials без повторного
ввода секрета.
XMLStock после успешных read-only account ответов получает только catalog
allowlist `SERP_RANK_TRACKING`, `SERP_COLLECTION` и `WORDSTAT`. Ошибки
авторизации, очереди/лимита и временной недоступности нормализуются без
сохранения provider body. Подключение показывается в public operational
catalog и требует полной пары `USER ID + KEY` при создании и ротации.

Management API принимает только полную замену secret payload и не вызывает
провайдера. Public decrypt adapter разрешён только role `EXECUTION`, однако
оба процесса пока получают один symmetric KEK: компрометация management
process технически позволяет выполнить unwrap вне adapter. До production
нужна криптографическая граница через KMS/asymmetric wrapping либо отдельный
credential broker, закреплённая ADR; execution process также не получает
fingerprint keyring/credential API token.

Connector PostgreSQL login больше не получает direct table DML: permissions
script отзывает connector и `PUBLIC` privileges на schema/tables/sequences/
functions, затем выдаёт только exact broker/rank-claim `EXECUTE`. Validation
broker возвращает due IDs, exact claim projection и выполняет fenced atomic
finish; `jobs`, `integration_credentials` и canary table напрямую недоступны.
Fresh PostgreSQL 18 regression под `NOLOGIN` non-owner role проверяет direct/
management denial, отсутствие `PUBLIC` bypass, arbitrary/non-validation UUID,
concurrent claim, reclaim и stale finish, tenant/material drift, atomic result
и `pg_temp` shadowing. Global vault read blocker внутри `jobs_db` закрыт.
Перед production всё ещё обязательны provisioning тем же script в целевом
окружении, cluster-wide grant audit, `pg_hba`/отдельный cluster boundary и
отдельный Redis ACL/instance; owner/superuser runtime запрещён.

Startup fail-closed сверяет используемые в БД KEK/fingerprint versions с
соответствующими keyrings. Автоматический bounded DEK rewrap и отдельная
bounded-инвалидация fingerprints после retry window остаются обязательным
operational hardening до удаления старых версий. Отображение
`keyVersion → KEK bytes` immutable: новое значение всегда получает новую
версию. Rollout выполняется только как expand keyring → startup canary verify
configured ∪ used versions → drain старых replicas → switch active.

Coverage guard проверяет наличие версии, а missing-version retry оставляет
credential без изменений при её отсутствии. `MANAGEMENT` для каждой
настроенной KEK version создаёт synthetic known-plaintext envelope с отдельным
canary AAD и регистрирует его expand-only; существующую version нельзя
перезаписать. `EXECUTION` replica до создания BullMQ worker получает через
bounded broker canaries для объединения всех локально configured versions с
versions, реально используемыми неудалёнными credentials; запрос ограничен
128 уникальными canonical positive PostgreSQL integers, и итоговая projection
также ограничена 128 target versions. Usage marker отличает
used-but-unconfigured version, missing canary остаётся nullable строкой, а
retired unused unrequested historical version не возвращается. Replica
проверяет оба AES-GCM слоя каждого результата, включая новый ещё не active KEK.
Canary table не содержит workspace, provider, credential ID или tenant secret.
Пустая БД допустима; missing/corrupt/same-version-wrong-key canary
останавливает startup fail-closed, а ошибка содержит только номера версий.
При совместном запуске нескольких process roles из одного artifact EXECUTION
может ограниченно ждать первоначальную регистрацию отсутствующего canary
MANAGEMENT-процессом. Ожидание выполняется до создания BullMQ worker, не даёт
EXECUTION права записывать canary и не применяется к corrupt/wrong-key
результату; по истечении окна startup завершается fail-closed.
`MANAGEMENT` также сохраняет агрегированную проверку encryption/fingerprint
coverage.
Validation worker по-прежнему обрабатывает любой runtime decrypt failure как
job-only bounded retry без изменения credential status. Ошибка логируется на
error-level и попадает в operational alert supervisor; отдельный cluster-wide
circuit breaker всё ещё не реализован.

Runtime validation ограничивает provider timeout диапазоном
`1 000–120 000 ms`, lease — `10–600 s` и минимум `timeout + 5 s`,
dispatcher — `5–300 s`, concurrency — `1–32`. Первый validation допускает
не более трёх attempts; exponential delay ограничен 300 секундами, а
provider `Retry-After` — 3 600 секундами.

Каждый credential `info` request проходит через общий для всех Arsenkin
connector workflows и replicas Redis sliding-window limiter на 30 HTTP
requests за 60 секунд; при недоступности limiter запрос блокируется
fail-closed. Отказ локального limiter у фоновой проверки ключа означает
повтор самой проверки и не превращает уже подтверждённый рабочий route в
`CONNECTOR_NOT_READY`. DB-enforced single-active cap на credential/material остаётся
отдельным ограничением. Перед multi-tenant beta обязательны единый
cross-workflow cap пяти одновременно исполняемых provider tasks, server-side
per-workspace/provider quotas и fair scheduling. Terminal validation result
также должен записывать redacted
transactional outbox event для durable audit и email/Web Push; audit записей
`requested/queued` в Platform API для этого недостаточно.

### 17.2. Внутренняя проектная проекция connector

Jobs/integrations владеет нормализованными
`project_connector_bindings`, `project_connector_routes` и
`project_connector_binding_create_receipts`. На
`workspace + project + capability` разрешён один binding. Он не является
пользовательской настройкой: новый resolver всегда materialize-ит в него
workspace binding, чтобы существующие estimate/execution FK оставались
неизменными. Legacy mutation routes сохраняются для rolling compatibility, но
созданный ими `PROJECT_OVERRIDE` больше не участвует в новом выполнении.

Базовый route использует `position=0`. Bounded routes `position=1..7`
повторяют workspace fallback chain и позволяют операции явно начать с
выбранного credential, не меняя сохранённый порядок. Для каждого route
обязательны:

- `sourceKind=WORKSPACE_CREDENTIAL`;
- non-deleted credential того же workspace;
- mode совместим с capability (`BYOK_API_KEY` либо явно разрешённый
  `PLATFORM_PAID`);
- capability одновременно присутствует в сохранённом credential JSON и
  текущем provider catalog.

Если credential после настройки стал pending/invalid/revoked или потерял
capability, GET сохраняет binding и возвращает явный availability. Runtime
status, balance и rate limit не входят в инвариант сохранения или перестановки
workspace route; execution resolver проверяет их заново перед каждым новым
submit. Автоматическое переключение на системный ключ без заранее настроенного
route и требуемого согласия запрещено.

После cross-workspace transfer Execution сохраняет выключенный project binding
и retire-ит routes. Он остаётся audit-состоянием до появления workspace route;
прежний provider автоматически не восстанавливается.

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

Platform credentials и hard binding budgets пока строго возвращают
`FEATURE_NOT_AVAILABLE`. BYOK fallback реализован как bounded pre-submit route
resolution и не заменяет estimate/reservation/settlement. Сам binding не
запускает provider operation: фактический маршрут повторно проверяется и
снимком фиксируется при создании операции. Для XMLStock Wordstat эта проверка
учитывает верхнюю стоимость полного request scope, поэтому заведомо
недостаточный основной аккаунт не получает часть элементов перед переходом к
резерву.

Между проверкой lifecycle проекта в Platform API и commit в отдельной
jobs database остаётся межсервисное TOCTOU. До первого исполняемого SEO job
jobs/integrations должен получить authoritative lifecycle projection/inbox
либо другую проверяемую precondition; worker в любом случае повторно проверяет
workspace/project/billing перед provider call.

### 17.3. Реализованный provider-free rank estimate

`rank_estimates` — отдельный Jobs-owned operational resource, а не состояние
`Job`. Internal create доступен только Platform API через dedicated
credential boundary и требует совпадения workspace/project/actor в path,
trusted headers и exact body, а также отдельный `Idempotency-Key`.

До первого provider call сервис:

- возвращает exact immutable replay до повторного вызова SEO Data;
- при новом key получает bounded atomic scope у SEO Data;
- не выбирает ciphertext, nonce, auth tag, encrypted DEK или provider
  metadata;
- читает binding `SERP_RANK_TRACKING`, route `position=0` по умолчанию либо
  exact bounded route явно выбранного provider/credential и allowlisted
  credential metadata;
- считает credential свежим только при `ACTIVE` current material,
  совпадающей текущей connector version и terminal validation proof;
- формирует для scope до 15 000 пар один provider task, но не объявляет
  неизвестное число polling requests точным;
- сохраняет private version snapshot и отдельный redacted public snapshot;
- не создаёт очередь, usage, reservation, provider request или outbox event.

Receipt живёт логически пять минут. Точный replay возвращает тот же
`expiresAt` и не продлевает TTL; явный перерасчёт использует новый key.
Другой payload под прежним key возвращает `IDEMPOTENCY_CONFLICT`. Текущий
`rank-runs` не рассматривает estimate как grant: создание
`PREPARING` Job повторно проверяет expiry, integrity immutable receipt и
Jobs-owned mutable binding/route/credential/validation versions. Current
context/configuration/semantic scope повторно проверяет SEO Data во время
seal. Актуальный lifecycle проекта пока остаётся trusted caller snapshot с
межсервисным TOCTOU; перед будущим provider submit требуются authoritative
project precondition и одноразовый execution grant.

Blockers имеют finite vocabulary из `platform-contracts` и локализуются Web.
Provider contract gate и execution kill switch разделены. Пока оба закрыты,
estimate всегда `BLOCKED`; это намеренно не запускает read-only credential
validation connector и не доказывает работоспособность `positions`.

### 17.4. Реализованный SEO Data immutable manifest и finalize

SEO Data предоставляет dedicated-auth seal/chunk boundary, который уже
вызывает Jobs `PREPARING` saga. Он сверяет trusted project snapshot из
command и повторно проверяет current context, configuration и semantic scope
evidence из estimate, ограничивает Arsenkin slice 15 000 ключами и сохраняет
exact keyword snapshots одного provider task.

State machine `BUILDING → SEALED → CLOSED` защищена DB triggers: committed
`BUILDING`, direct sealed insert, mutation/deletion/truncate и late child
запрещены. Partial unique active semantic hash блокирует эквивалентную
provider work даже после rename, display-only configuration label, metadata
edit или reassignment. `CLOSED` сохраняет manifest/history и только
освобождает active key.

Protected endpoint
`POST /internal/v1/projects/{projectId}/rank-manifests/{manifestId}/finalize`
проверяет exact tenant/job/finalization command, делает replay идемпотентным,
атомарно переводит `SEALED → CLOSED` и сохраняет immutable finalization
receipt. В текущем срезе он завершает zero-persisted
`CANCELLED/FAILED/ACTION_REQUIRED`; успешный и частичный outcome закрыты
fail-closed до появления normalized ingest.
Idempotency identity включает job/manifest/status, но намеренно не audit
`actorId`: первый успешный writer фиксирует provenance, а повтор другого
уполномоченного actor возвращает исходный receipt.

### 17.5. Реализованный durable Jobs PREPARING runtime

Jobs/integrations предоставляет защищённые internal endpoints:

- `POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/rank-runs`;
- `GET /internal/v1/workspaces/{workspaceId}/projects/{projectId}/jobs/{jobId}`;
- `POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/jobs/{jobId}/cancel`.

Create использует DB-first порядок: в одной транзакции повторно проверяются
estimate и mutable binding/route/credential/validation evidence, затем
создаются `Job(PREPARING)`, immutable exact manifest command и его
32-byte hash в sidecar `rank_job_runs`. Только после commit публикуется
неавторитетное сообщение `rank-preparation` с одним `jobId`. Producer не
накапливает offline Redis commands и имеет bounded connect/command timeout:
недоступная очередь не удерживает уже закоммиченную HTTP-команду, а
PostgreSQL dispatcher восстановит notification.

Sidecar хранит независимую state machine:
`PENDING → OUTCOME_UNKNOWN|NOT_SEALED`,
`OUTCOME_UNKNOWN → NOT_SEALED|SEALED` и `SEALED → FINALIZED`, seal attempts,
immutable manifest receipt и immutable finalization receipt.
`OUTCOME_UNKNOWN` устанавливается до internal HTTP, поэтому crash/timeout не
создаёт ложное доказательство отсутствия manifest. Только заранее
классифицированные ошибки, доказывающие отсутствие seal, переводят run в
`NOT_SEALED`. Retryable transport/service ambiguity повторяет ту же
идемпотентную exact seal/finalize command в пределах 20 attempts;
non-retryable ambiguity либо исчерпание budget завершает Job как
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`. Неидемпотентный provider submit
имеет отдельный durable may-have-started marker и никогда автоматически не
повторяется после неоднозначного transport outcome.
Exact command до каждого HTTP повторно сверяется с immutable
workspace/project/actor/job/estimate/context/domain/version/pair binding;
self-consistent hash для другого graph не покидает сервис.

Create вставляет parent Job, затем sidecar в одной транзакции под
unique/deferred constraints. Все конкурентные мутации существующего graph
блокируют агрегат в порядке `Job → RankJobRun`. После seal request
допускается только один контролируемый version drift: cooperative cancel мог
записать `CANCEL_REQUESTED`, пока worker ждал SEO Data. Только
`PENDING + attempt=0` отменяется немедленно как
`NOT_SEALED/CANCELLED`. Для `OUTCOME_UNKNOWN` или `SEALED` сначала
фиксируется `CANCEL_REQUESTED`; exact recovery затем даёт доказанный
`NOT_SEALED/CANCELLED`, `FINALIZED/CANCELLED` либо, если исход безопасно не
установлен, terminal `ACTION_REQUIRED`.
Serialization/deadlock conflicts повторяются bounded: terminal/cancel
состояние возвращается как authoritative replay, а неразрешённая active
гонка — как контролируемый `503`, а не неконтролируемый `500`.

DB triggers требуют exact initial `PREPARING/PENDING`, monotonic Job
version/attempt, immutable estimate/command/receipts, provenance первого
cancel и согласованное committed состояние `Job ↔ RankJobRun ↔ RankEstimate`.
Migration fail-closed останавливается при legacy `MANUAL_RANK_CHECK` без
sidecar либо active dedup conflicts. Обычный rebuild unique index требует
worker drain/maintenance window; large live database использует отдельный
expand/concurrent-index rollout.

Public Platform API routes и Web Job flow для create/get/cancel подключены;
normalized ingest/finalize, internal/public history и completion outbox также
реализованы. Jobs-side bounded grant client и durable intent/decision
history реализованы. До grant отдельный rank-worker читает authoritative
sealed manifest chunk, сохраняет immutable exact provider request intent и
повторно сверяет тот же chunk/graph при replay; keyword text не попадает в
queue/log/event и не смешивается с credential material. Валидный grant теперь
атомарно получает `CONSUMED` вместе с secret-free
`rank_connector_executions/READY_TO_SUBMIT`, а execution обязан ссылаться на
совпадающие intent/request/manifest/chunk hashes.
SECURITY DEFINER claim DDL добавляет bounded lease,
pre-network `CLAIMED`, full current-graph recheck и единственную scoped
encrypted credential projection. `PUBLIC` execute отозван; connector
permission allowlist выдаёт exact `EXECUTE` только на public claim и
authorize. Authorize повторно проверяет полный current graph, lease fence и
ожидаемые execution/control versions, затем атомарно переводит execution в
`SUBMITTING` и фиксирует durable may-have-started marker. Connector-worker
отправляет documented `positions`, сохраняет wire hash/task ID, выполняет
`check → get` только после `finish/100` и stage-ит normalized `result.table`;
provider queue/wait статусы остаются в `POLL_WAIT`; rank-worker ingest-ит
chunk и terminal закрывает manifest/Job. Runtime
activation использует новую immutable kill-switch generation
`arsenkin-positions@4`. Live BYOK request/status/result canary зафиксирован
4 августа 2026 года. В тот же день минимальный XMLStock rank canary прошёл
submit/result на одном keyword; отдельными release gates остаются provider
alerting/circuit breaker и эксплуатационный мониторинг расписаний.

Автоматическое обновление validation proof не запускается из rank connector
после каждого submit/poll: такой refresh меняет `credential.verifiedAt`.
Hourly и
provider-operation scheduler исключает credential, пока связанный с его
текущей material version `MANUAL_RANK_CHECK` находится в
`PREPARING/QUEUED/RUNNING/CANCEL_REQUESTED` и не финализирован. Ручная смена
credential или routing по-прежнему является осознанным drift и завершает
исполнение fail-closed как `ESTIMATE_STALE`, а не маскируется под
`INTERNAL_ERROR`. Для Job, уже пересёкшегося с refresh до установки fence или
во время rolling upgrade, grant допускает более новую completed validation
только того же credential, connector и `materialVersion`. Текущие credential
version/`verifiedAt` и validation input повторно связываются с execution
evidence PostgreSQL-триггером; смена секретного материала не допускается.

### 17.6. Platform-owned execution grant issuer foundation

Platform API предоставляет protected internal endpoint
`POST /internal/v1/workspaces/{workspaceId}/projects/{projectId}/rank-execution-grants`.
Он требует dedicated caller token, exact single-value
`X-Request-Id/X-Workspace-Id/X-Project-Id/X-Actor-Id/Idempotency-Key`,
совпадение path/headers/body и `Cache-Control: no-store`.

Issuer в `Serializable` transaction блокирует workspace, project, user,
membership и project access в canonical parent-before-child порядке,
повторно проверяет lifecycle/version/domain/RBAC и вызывает policy внутри той
же транзакции. `GRANTED` невозможен без authoritative
`quotaReservationId`; для BYOK это immutable usage/grant binding без дневного
admission cap. Новый receipt отвечает `201`, exact replay — `200`, reuse
key/scope — `409`. Replay всегда возвращает сохранённый decision, даже если
30-секундный grant уже истёк.

Request несёт только opaque `executionEvidenceHash`, но не
binding/route/credential IDs или secrets. Bounded Jobs client и durable
attempt table реализованы fail-closed и строго проверяют request/scope hashes,
exact decision envelope и expiry. Неистёкший grant уже атомарно связывается с
secret-free scoped execution под повторной проверкой Job/item/credential
projection и exact provider request intent. Connector permission script
выдаёт exact `EXECUTE` на public SECURITY DEFINER claim и authorize: claim
возвращает только одну current
credential projection и оставляет execution в pre-network `CLAIMED`.
Authorize под canonical locks повторно проверяет current graph,
owner/token/generation fence, ожидаемые execution и control versions,
атомарно устанавливает `SUBMITTING` и durable may-have-started marker.
Runtime caller выполняет outbound provider request, post-response billing
settlement для `PLATFORM_PAID` и локальный complete только через lease-fenced
brokers. Submit остаётся default-off kill switch и включается лишь после
provider/legal/operational canary gates.

### 17.7. Jobs-owned execution grant intent и atomic consume

Перед grant Jobs materialize-ит точный private adapter command в
`rank_provider_request_intents`. Rank-worker под `Job → RankJobRun → JobItem`
locks проверяет sealed command/reference, отпускает locks на время bounded
dedicated-auth GET manifest chunk, затем повторно блокирует и сверяет graph до
append-only INSERT. Snapshot канонизирован RFC 8785 JCS, ограничен одним
chunk/250 keywords и содержит domain/execution/keyword text/hash/language,
но принципиально не может содержать credential ID, ciphertext, API key или
raw provider response. Existing replay снова получает authoritative chunk и
сравнивает полный snapshot. Execution evidence `rank-execution-evidence@2`
и tenant-safe FK связывают intent ID/request hash с exact manifest/chunk
hashes; mutation/delete/truncate запрещены. Таблица недоступна general
`jobs_runtime`: только отдельный rank-worker login имеет `SELECT, INSERT`, без
sequences/default privileges или доступа к upload/import/outbox/canary data.
RLS ограничивает видимость manual rank/validation и
`SERP_RANK_TRACKING` graph; vault читается только по metadata column allowlist
без ciphertext/DEK/nonces/tags. Минимальный `UPDATE(id)` нужен PostgreSQL для
row locks, но owner-owned guards отклоняют любой фактический write в эти
lock-only rows.

Перед первым HTTP к issuer Jobs в одной транзакции блокирует граф в порядке
`Job → RankJobRun → JobItem → credential → validation Job → binding → route`,
повторно сверяет sealed manifest/chunk, immutable authorization snapshot,
estimate execution evidence, текущие binding/material/validation/connector
versions и kill-switch version, затем сохраняет immutable exact `REQUESTED`
в `rank_execution_grant_attempts`. Request snapshot, независимые request/scope
hashes, execution-evidence hash, Job version, execution attempt и stable
idempotency key записываются до network boundary.

Retryable transport ambiguity не создаёт новый intent: повтор использует тот
же exact request и idempotency key. После ответа Jobs снова удерживает
canonical graph locks и attempt row, использует database clock, повторно
сверяет локальный execution graph и сохраняет одно из состояний:

- `DENIED` — issuer отказал, decision snapshot terminal и immutable;
- `EXPIRED` — exact `GRANTED` уже истёк по DB clock;
- `GRANTED_PENDING_CONSUME` — grant валиден, но ещё ничего не авторизует;
- `REJECTED_LOCAL` — ответ или изменившийся локальный graph не прошёл exact
  fail-closed проверку.

`GRANTED_PENDING_CONSUME` повторно проверяется под тем же graph lock order.
До истечения grant одна транзакция создаёт единственную secret-free
`rank_connector_executions/READY_TO_SUBMIT` и переводит attempt в
`CONSUMED`; deferred constraint запрещает commit любой половины этой пары.
Execution row содержит tenant/job/item/manifest и версии
binding/route/credential/validation/connector/kill-switch, но не ciphertext,
wrapped DEK или provider payload. Service зарегистрирован только в
rank-worker module и вызывается dispatcher-ом для каждого sealed chunk.
Dedicated
`JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` получают только Platform API и
rank-worker; generic Jobs HTTP, connector/import/inspection/system/migration,
Web и остальные сервисы token не получают. Submit flag принимается только
isolated connector-worker; rank-worker всегда запускается с этим флагом
выключенным.

Migrations `20260729230100_rank_execution_grant_attempts`,
`20260729230200_rank_connector_executions`,
`20260730101500_rank_connector_execution_claim`,
`20260730101700_rank_connector_submitting_enum` и
`20260730101800_rank_connector_submit_authorization` прошли PostgreSQL 18
fresh full-chain и upgrade rehearsal. Exact non-owner connector permissions,
default-closed control, stale-head skip, concurrent claim/reclaim и
claim/authorize fence races также проверены на PostgreSQL 18. Pure TypeScript
lifecycle моделирует request/status/result transitions и трактует commit
authorize как may-have-started boundary; PostgreSQL brokers сохраняют wire,
poll, normalized staging и result-persistence state. Retryable submit outcome
не возвращает ту же execution в
`READY_TO_SUBMIT`: scheduler обязан получить новый authoritative grant и
создать следующий monotonic `execution_attempt`. Credential validation
worker/KEK canary и provider runtime не требуют global vault read.

### 17.8. Реализованная caller/audience service authentication

Legacy `INTERNAL_API_TOKEN` выведен из эксплуатации и отклоняется startup.
Обычные internal HTTP route groups используют четыре независимые границы:

- `PLATFORM_API_TO_SEO_DATA_TOKEN`: Platform API → SEO Data;
- `PLATFORM_API_TO_JOBS_TOKEN`: Platform API → Jobs HTTP;
- `JOBS_TO_SEO_DATA_TOKEN`: Jobs HTTP/import worker → SEO Data;
- `PLATFORM_API_TO_REALTIME_TOKEN`: Platform API → Realtime general HTTP.

`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`, `JOBS_TO_SEO_RANK_TOKEN`,
`JOBS_TO_SEO_RANK_RESULT_TOKEN`, `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`,
`JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN`,
`JOBS_TO_PLATFORM_AUTOMATION_TOKEN`,
`PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN` и
`REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN` остаются отдельными dedicated
credentials своих узких границ. General token не расширяет их permissions.

Runtime принимает только generated distinct tokens длиной `32..512` visible
ASCII без whitespace, control characters и comma; example placeholders и
reused values отклоняются. Guard требует один exact header и не принимает
duplicate/array/combined значения. Все реализованные internal fetch clients
задают `redirect: "error"`, поэтому credential не пересылается на другой
origin. Это symmetric-token hardening текущего среза, а не замена целевой
service JWT/mTLS identity и не доказательство полной production готовности.

### 17.9. Реализованный platform-paid rank slice

Для ручного съёма позиций реализован второй credential mode
`PLATFORM_PAID` для XMLStock и Arsenkin:

- пользователь включает системное подключение только с workspace permission
  `integration.use_system_credentials`; browser передаёт лишь provider и
  idempotency key, но не цену и не секрет;
- исходные platform API credentials находятся только в environment
  management-role Jobs HTTP process. Рекомендуемые переменные
  `PLATFORM_XMLSTOCK_API_KEYS`, `PLATFORM_XMLSTOCK_ACCOUNT_IDS` и
  `PLATFORM_ARSENKIN_API_KEYS` принимают до 64 значений через запятую;
  XMLStock требует список уникальных account ID той же длины: элементы с
  одинаковым индексом образуют одну пару API key/account ID. Legacy
  singular-переменные поддерживаются для одного ключа, смешивание форматов и
  дубликаты отклоняются fail-closed;
- при включении весь пул шифруется vault-моделью в отдельную workspace
  credential row, после чего connector worker получает материал через тот же
  lease-fenced decrypt boundary, что и BYOK. API keys, account IDs и даже их
  маски не попадают в browser, Redis, Job payload или operational alerts;
- каждому физическому ключу management-role выводит стабильный непрозрачный
  UUID через самый старый ещё покрывающий active credentials HMAC fingerprint
  key. Platform credential request fingerprint сохраняется с той же key
  version, поэтому startup key-coverage запрещает убрать её до revoke всех
  зависимых credential rows; overlap-ротация active fingerprint version не
  делит Redis bucket. Rank
  runtime выбирает ключ rendezvous
  hashing по immutable execution ID: распределение не зависит от порядка
  списка, а submit/poll/retry после рестарта остаются на одном ключе;
- XMLStock Redis quota buckets и Arsenkin rolling window используют этот
  непрозрачный UUID, поэтому лимит одного физического ключа делится между
  workspace и всеми connector replicas, но не блокирует остальные ключи.
  Redis fail-closed ограничивает внешний HTTP и не является источником Job,
  billing или provider-task state;
- физические platform accounts проверяются management-role напрямую из
  environment по сохранённой индексной паре. Успешная фоновая проверка
  повторяется не чаще одного раза в 15 минут; ручная команда только помечает
  текущие включённые аккаунты для ближайшей проверки. Admin может отключить
  конкретный аккаунт: новые операции исключают его из rendezvous selection,
  но уже принятый provider task завершает polling на первоначальном ключе;
- одновременно допускается не более одной активной platform credential одного
  provider на workspace. Её нельзя редактировать как пользовательский ключ;
  смена platform secret выполняется через revoke/re-enable после controlled
  rotation;
- catalog показывает системный вариант только при одновременной конфигурации
  provider flag, секрета и Core price book. После создания запускается обычная
  read-only validation, а quota/account metadata platform account наружу не
  выдаётся;
- Core вычисляет customer price на одну keyword-context проверку из trusted
  environment price book. Execution повторно связывает эту цену с immutable
  estimate и сохраняет полную стоимость Job; browser может только подтвердить
  точную `platformChargeMicro` из estimate;
- для каждого включённого provider обязательны
  `PLATFORM_*_DAILY_SPEND_LIMIT_MINOR` и
  `PLATFORM_*_MONTHLY_SPEND_LIMIT_MINOR`, причём monthly не меньше daily.
  Перед созданием нового reservation Core берёт provider-scoped PostgreSQL
  advisory transaction lock и атомарно считает captured usage текущего
  UTC-day/month плюс все неистёкшие reservations между всеми workspace.
  Новый grant, превышающий хотя бы один hard cap, получает `EXHAUSTED` до
  ledger mutation и provider I/O; idempotent replay уже созданного reservation
  не списывается и не блокируется повторно;
- Arsenkin создаёт один provider task до 15 000 keywords, но customer charge
  считается по каждой keyword, а не как одна единица за task. XMLStock
  распределяет ту же per-keyword цену по item/chunk graph;
- grant создаёт double-entry usage reservation из included credits, затем
  prepaid balance. Stable business reference привязан к Job item, поэтому
  новый технический execution attempt для того же неиспользованного item не
  списывает токены повторно;
- перед первым синхронным XMLStock HTTP request connector получает bounded
  `HOLD`, который проверяет живой резерв и может продлить его только на
  минутное provider/capture окно без ledger mutation. После подтверждённого
  платного provider outcome connector вызывает `CAPTURE` отдельного закрытого
  Core settlement endpoint. Только exact `CAPTURED` разрешает локально
  завершить submit/checkpoint/result; reject, rate limit и transport ambiguity
  токены не списывают. BYOK проходит тот же runtime без обращения к ledger.
  Неиспользованный резерв автоматически release-ится bounded reconciliation
  после 10 минут;
- platform-paid rank automations разрешены только с сохранённым явным
  `maxPlatformChargeMicro` на один запуск. Каждый occurrence получает fresh
  estimate через закрытый Jobs → Core dispatch, повторно проходит актуальные
  RBAC/lifecycle/entitlement/quota/capacity checks и использует стандартные
  reservation, HOLD, CAPTURE и settlement boundaries RankRun. Цена выше cap,
  недоступный баланс или изменившиеся права завершают automation run до
  provider I/O; `0` сохраняет BYOK-only. Paid `retry-missing` остаётся
  намеренно отклонённым до отдельного product/finance решения. Пользовательский
  keyword cap отсутствует: fresh estimate охватывает весь текущий tracking
  context, а старый `maxItems` из definition schema `@1/@2` только читается для
  совместимости и отбрасывается при нормализации в `@3`.

Capability по умолчанию выключена. Reserve происходит до provider call,
bounded HOLD — непосредственно перед первым синхронным вызовом, capture —
после подтверждённого outcome провайдера и до сохранения локального outcome. При
недоступности settlement Core пользователь не списывается и outcome не
фиксируется, хотя платформа уже могла понести provider cost. Production flag
нельзя включать до fault-injection canary этого окна, проверки
refund/reconciliation, заполнения hard budget, provider balance alert и выполнения
legal/provider activation gates.

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

- Яндекс XML: `/yandex/xml/`, `query`, `lr`, `device`, `domain`,
  TOP-30/50/100 через `groupby`; production path использует `delayed=1`,
  сохраняет opaque `req_id`, первый poll через 15 секунд и следующие через
  25 секунд;
- Google XML: `/google/xml/`, `query`, `lr`, `device`, `domain`, `hl`; из-за
  ограничения 10 результатов на страницу глубина TOP-30/50/100 собирается
  из 3/5/10 `page` запросов, начиная с нулевой страницы;
- Wordstat JSON: `/wordstat/json/`, `pagetype=words`, регион и устройство;
  BASE/EXACT/FIXED формируются операторами `query`, `"query"`, `"!query"` и
  хранятся раздельно. Для expansion один seed передаётся одним GET,
  `groupby=1..2000` ограничивает `results`, а `associations` нормализуется как
  правая колонка. `groupby` не является batch входных keyword;
- credential validation использует бесплатные read-only запросы
  `/api/?info=user`, `/api/?info=status` и `pagetype=regionsTree`. Из
  `info=user` сохраняются только текущие account-specific цены инструментов,
  тариф определяется по официальной сетке ставок, а персональные method URL,
  USER ID и KEY отбрасываются на границе parser/DB guard. `info=status`
  добавляет только числовую доступность и нагрузку инструментов;
- ответы разбираются потоковым bounded XML parser либо bounded JSON parser;
  raw provider payload не сохраняется, наружу выходят только нормализованные
  позиции, релевантные URL, частотности и безопасные error codes;
- BYOK остаётся доступным режимом первого релиза. Пользователь вводит XMLStock `USER ID + KEY`,
  которые хранятся одним зашифрованным credential payload;
- технический platform-paid rank path существует за выключенным feature flag
  и включается только после согласования допустимой схемы коммерческого
  использования и выполнения activation gates из разделов 17.9 и 26 billing
  specification;
- `soft_id`/партнёрская атрибуция не передаётся без отдельной коммерческой
  конфигурации владельца платформы;
- raw SERP и HTML response не сохраняются. Безопасные баланс, тариф и ставки
  XMLStock показываются в настройках и перед запуском. В immutable scope
  rank/frequency/Wordstat-expansion операции фиксируются продукт, ставка,
  время получения цены и диапазон ожидаемых оплачиваемых запросов. Result
  workspace показывает фактическое либо доказуемое по durable attempts число
  запросов и рассчитанный расход; polling готовности Search API не считается
  новым оплачиваемым поисковым запросом.

### 21.4. Keys.so

- REST JSON;
- API token header;
- проектная вкладка получает dashboard TOP-метрики, organic keywords и
  bounded список доменов-конкурентов;
- normalized keyword row содержит запрос, URL, позицию и доступную частотность;
- SERP tasks;
- async `202` polling;
- `429 Retry-After`;
- provider report IDs;
- run сохраняется в `keyword_research_runs/keyword_research_rows`, а импорт
  выполняется отдельной import-worker ролью только после явного confirm;
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
- Yandex positions через Arsenkin в текущем connector contract поддерживает
  только `Топ-30`; выбор подключения не скрывается, а ограничение явно
  отображается до запуска;
- clustering принимает один immutable scope до 300 000 запросов; public и
  trusted create routes имеют отдельный request body limit 32 MiB, а trusted
  proposal ingestion — 256 MiB. Жёсткий метод расположен слева и выбран в UI
  по умолчанию, все виды частотности изначально выключены. UUID items в fenced
  командах передаются одним typed PostgreSQL array parameter;
- indexation and supported SEO tools;
- provider task cleanup;
- Wordstat frequency использует один `set` на весь допустимый platform batch
  до 10 000 query, `check` до статуса `finish` и один `get` на общий task ID;
  positions использует один `set` на sealed rank task до 15 000 keyword.
  Per-keyword paid submit запрещён;
- Wordstat expansion использует отдельный документированный tool `type=2`:
  до 500 seed-фраз отправляются одним `set`, обе колонки `left/right`
  нормализуются в staging до 10 000 строк. Уже сохранённый provider task ID
  только poll-ится и никогда не submit-ится повторно. Arsenkin API не получает
  пользовательский result limit; 10 000 является внутренней границей staging,
  тогда как XMLStock сохраняет явный пользовательский лимит. После preview
  импорт поддерживает общую папку, автоматические подпапки по seed-фразам и
  абсолютное переопределение папки для отдельных строк;
- BYOK остаётся доступным режимом первого релиза;
- пользователь должен иметь тариф Arsenkin Tools с API;
- технический platform-paid rank path существует за выключенным feature flag
  и включается только после согласования с провайдером коммерческой схемы,
  передачи результатов третьим лицам и выполнения activation gates из
  раздела 17.9 и billing specification;
- connector получает отдельное разрешение на каждый Arsenkin `set`, `check`,
  `get` и credential `info` через общий для workflows и replicas Redis
  sliding-window limiter: для platform pool rank bucket разделён по
  HMAC-идентификатору физического ключа, не более 30 HTTP requests за 60 секунд
  на ключ, fail-closed при недоступности limiter;
- fenced DB-bound cap резервирует не более пяти одновременных provider tasks
  суммарно для Rank, Wordstat, AI answer и clustering; ожидание свободного slot откладывает Job без
  расходования poll attempt и без повторного `set`.

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
- реализованный auth-email transport — выделенный SMTP worker по ADR-2026-038;
- templates by locale;
- verification/reset/invite token передаётся только во fragment и
  materialize-ится JIT из authoritative Platform state;
- production SMTP provider/account/sender/credentials задаются оператором и
  не хранятся в repository;
- bounce/complaint handling;
- unsubscribe for non-transactional messages;
- delivery events.

Bounce/complaint handling, unsubscribe, digest и delivery history относятся к
общему notification email sender и ещё не считаются реализованными
transactional auth-email срезом.

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

### 25.1. Проектный журнал пользователя

Private/noindex маршрут `/app/tasks` объединяет доступные пользователю
операции частотности, позиций, обычной выдачи конкурентов, технического аудита,
проверки HTTP-статусов, проверки ИИ-ответов, ИИ-выдачи конкурентов,
кластеризации и экспорта семантики. Завершённая строка
экспорта предоставляет тот же permission-checked download route, что и drawer
семантики; активный экспорт остаётся отменяемым, но не изображает готовый файл.
Это
построчный журнал, а не kanban: строки сортируются по времени создания,
фильтруются по статусу и типу и открывают один detail inspector. В деталях
показываются безопасные входные параметры, прогресс, итоговые счётчики,
время, redacted ID и finite error code; приватные keyword texts, credential
material и raw provider payload не проецируются. WebSocket не является
источником истины: экран периодически перечитывает owning read models и умеет
частично деградировать при недоступности одного из них. Поэтому отдельные
индикатор «онлайн» и кнопка ручного обновления не показываются. Для проверки
позиций строка и detail явно показывают provider, точный источник выдачи
(`Яндекс XML`, `Яндекс Live` или `Google Live`) и зафиксированную глубину
`Топ-30/50/100`; эти поля берутся из immutable scope, а не восстанавливаются
из текущих настроек проекта. Legacy-запускам без однозначной версии маппинга
источник не приписывается предположением.
Rank-запуск с `purpose=COMPETITOR_SERP` является отдельным пользовательским
типом в фильтре и строке журнала, называется «Выдача конкурентов · Топ-10» и
открывает таблицу фактического органического Top-10, а не таблицу позиции
домена проекта с глубиной текущего контекста. `AI_ANSWER_COLLECTION` с тем же
purpose аналогично называется «ИИ-выдача конкурентов» и открывает таблицу
источников. Очереди и cancel/retry endpoints при этом остаются общими для
соответствующего доменного Job: разделение является точной purpose-aware
проекцией, а не дублированием исполнения.
Ошибочную terminal-операцию со статусом `FAILED_FINAL`, `ACTION_REQUIRED` или
`EXPIRED` пользователь с `task.manage` может убрать из проектного журнала.
`DELETE /projects/{projectId}/operations/{operationId}` записывает в Jobs
`dismissed_at` и `dismissed_by`; mutation атомарно увеличивает `Job.version`,
чтобы соблюдать optimistic-lock и terminal guards всех типов Jobs, включая
`MANUAL_RANK_CHECK`. Списки всех типов операций исключают такую
строку. Job, результаты, billing evidence и audit history физически не
удаляются. Активные, успешные, частично завершённые и отменённые операции этим
маршрутом скрыть нельзя.
Для `AI_ANSWER_COLLECTION` detail открывает cursor-paginated построчный лог и
в active, и в terminal состоянии: status/attempt, факт provider submit, finite
error и безопасную проекцию сохранённого ответа. Jobs применяет scope до
pagination, SEO Data добавляет только tenant-scoped label/snapshot точного Job;
сырой ответ провайдера и credential material не возвращаются.
Технический crawl хранит точный `purpose`: старое/отсутствующее значение
означает `TECHNICAL_AUDIT`, а `HTTP_STATUS_CHECK` получает собственное название,
факты, фильтры результата и terminal deep link. Purpose не создаёт новую
очередь: справедливость, per-workspace/global capacity, per-host lease и
backoff остаются общими.
Экран занимает один dynamic viewport, таблица прокручивается внутри рабочей
области без внешних карточных отступов и использует ту же compact app-шапку,
что семантика. Inspector имеет sticky header/footer и собственный scroll.
Кнопка результата открывает modal именно выбранной операции: status,
безопасный input snapshot, прогресс, итоговые счётчики и finite error; она не
перенаправляет пользователя в текущую семантику без контекста запуска.
Для XMLStock там же показываются сохранённый тариф и ставка за 1000 запросов,
число provider-запросов и стоимость в рублях по цене, зафиксированной при
создании операции. При восстановлении или ошибках, когда точное число нельзя
доказать, API возвращает явный минимальный и максимальный диапазон вместо
одного выдуманного значения.
Все result/log modal используют единый semantics-like workspace: компактную
таблицу с устойчивыми колонками и sticky состоянием загрузки. Над сводкой
показываются сохранённый контекст запуска, когда он существует, и безопасная
проекция пользователя по `actorId`; автоматический запуск подписывается явно.
В основную таблицу не выводятся credential/route ID, raw provider payload и
внутренние quality codes. Необязательные поля показываются только когда
содержат прикладные данные, поэтому разные операции не создают пустые широкие
колонки.
Строки rank/frequency результата выдаются cursor-страницами только размера
`200` или `500`: owning service применяет tenant/project/job scope до `take`,
а каждый следующий boundary проверяет непрерывную immutable `sequence` и
когерентный `nextCursor`. Modal автоматически запрашивает следующую страницу
по мере прокрутки и объединяет строки по immutable `sequence`; ручных кнопок
страниц нет. При активном запуске обновляется хвостовая cursor-страница, поэтому
новые строки появляются без перезагрузки, а provider-лимит операции не
становится лимитом размера одного HTTP-ответа. Счётчик загрузки закреплён снизу
modal; остановка доступна иконкой в header рядом с единственным крестиком
закрытия и требует отдельного подтверждения. Уже сохранённые строки и прогресс
после cooperative cancel остаются доступны.

Список проектов получает число активных операций одним tenant-scoped
агрегированным запросом Core API к Execution. Execution группирует только
пользовательские типы Jobs и активные состояния по `projectId`; Core сначала
применяет membership/permission scope и только затем присоединяет счётчики.
Недоступность этой необязательной проекции не блокирует список проектов.
Для живого состояния Core публикует отдельный permission-scoped
`GET /api/v1/workspaces/:workspaceId/operation-activity`. Persistent frontend
store является единственным источником badge в project selectors и command
bar, опрашивает этот endpoint чаще при наличии активных операций и повторяет
чтение после focus/visibility и локальных operation mutations. Успешный ответ
явно обнуляет доступные проекты без активных операций; dependency failure
оставляет последнее подтверждённое состояние и не раскрывает недоступные
project ID.

## 29. Режим сезонности в durable frequency job

Режим и нормализованный календарный диапазон входят в input snapshot и hash
`FREQUENCY_COLLECTION`. Broker возвращает их worker вместе с provider route.
Для `SEASONALITY` Arsenkin claim объединяет до 10 000 keywords в одну задачу;
перед внешним submit ставится durable marker и резервируется общий provider
slot. Paid part называется `SEASONALITY_TASK`, а результат сохраняется
внутренними batch до 100 ключей и 110 точек на ключ. Arsenkin принимает только
`BASE`; другие типы отклоняются после route resolution до provider request.
Polling принятой задачи не
повторяет submit и лениво загружает keyword scope только после статуса finish.
Готовый live-ответ `type=3` содержит массив строк query/data и отдельный
упорядоченный список dates. На больших оплаченных tasks PHP-проекция provider
может сериализовать строки как numeric-keyed object, пропустить полностью
нулевую фразу или отдельные нулевые даты. Нормализатор восстанавливает только
такие отсутствующие значения как нули по подтверждённому общему списку dates;
чужие query, дубли, невалидные даты и повреждённые непустые строки остаются
ошибкой. Ручной retry сохраняет provider task ID и повторяет только `get`, не
создавая новый оплачиваемый `set`.

XMLStock claim остаётся одноэлементным. Worker получает один распределённый
`WORDSTAT` permit и выполняет идемпотентную paid part `SEASONALITY_BASE`.
Live-проверка 9 сентября 2026 года по трём ключам и 24 месяцам показала
полностью одинаковые BASE/EXACT ряды; `!` в `pagetype=history` XMLStock
отклоняет как синтаксическую ошибку. Поэтому типы частотности в сезонности не
предлагаются. Каждый GET передаёт
`pagetype=history`, явные period/start/end/regions/device и type-specific
Wordstat query. После валидации RFC 3339 date и count нормализатор принимает
документированную строку share и фактически возвращаемое JSON-число; live-строка
только с date сохраняется как нулевая точка, а share без count отклоняется; все серии
одним fenced batch сохраняются в Core SEO; permit освобождается в `finally`.
Operation center, retry и result page используют `mode`, поэтому сезонность не
называется частотностью и не открывает таблицу чужого типа данных.
