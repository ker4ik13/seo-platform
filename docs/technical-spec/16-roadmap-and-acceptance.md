# Дорожная карта и критерии приёмки

## 1. Назначение

Этот раздел превращает целевое ТЗ в последовательность поставок. Этапы не привязаны к календарным датам: срок зависит от состава команды, выбранных платёжных и SEO-провайдеров, юридической подготовки и результатов нагрузочного прототипа.

Нельзя начинать массовую разработку без P0. Нельзя считать P1 публичным SaaS-релизом без обязательных частей P2 по безопасности, биллингу и эксплуатации.

## 2. Принципы этапности

- Каждый этап даёт проверяемый пользовательский результат.
- Сначала строится вертикальный сценарий, а не все слои каждого модуля.
- Архитектура допускает целевой масштаб, но инфраструктура растёт по метрикам.
- Microservice boundary фиксируется заранее, однако отдельные process replicas добавляются по нагрузке.
- BYOK появляется раньше использования системных ключей: это снижает ранний финансовый риск.
- Системные ключи включаются только вместе с ledger, reservation и cost estimate.
- Критичные provider integrations запускаются по одной общей adapter-модели.
- Импорт и семантическая таблица проверяются на реальных больших выгрузках до расширения набора SEO-инструментов.
- Client reports появляются после надёжности данных и permission model.
- AI-функции не являются блокером основной ценности.

## 3. Product increments

### P0. Discovery, прототипирование и фундамент

#### Цель

Снять главные технические и продуктовые риски до полномасштабной разработки.

#### Обязательные результаты

- утверждённое продуктовое название либо продолжение neutral placeholder;
- выбранные первые рынки и локали `en`/`ru`;
- legal checklist: entity, Terms, Privacy, DPA, cookie consent, payment geography;
- UX flows и high-fidelity макеты основных экранов;
- design tokens и component inventory;
- ADR по сервисам, databases, queues, storage и realtime;
- monorepo/multi-repo bootstrap согласно `12`;
- OpenAPI/event conventions;
- CI/CD skeleton;
- Dokploy staging;
- Node.js 24 runtime/build proof;
- PostgreSQL 18 + Prisma migration proof;
- прототип виртуализированной таблицы на 1–5 млн строк;
- прототип streaming import 2–5 GB;
- прототип rank-history partition/query;
- прототип WebSocket presence/cell selection;
- прототип Yjs/Hocuspocus документа;
- provider spike минимум для одного sync и одного async API;
- threat model;
- baseline observability.

#### Решения-gate

- таблица остаётся responsive при целевом объёме;
- импорт не требует загрузки файла целиком в RAM;
- схема partitioning подтверждена query plans;
- выбран способ tenant context;
- подтверждена возможность безопасного хранения credentials;
- Dokploy topology выдерживает staging flow;
- оценена стоимость системных provider keys.

Фактический infrastructure hardening для rank history уже требует в Compose
два независимых обязательных секрета:
`JOBS_TO_SEO_RANK_RESULT_TOKEN` для normalized-result write boundary и
`RANK_HISTORY_CURSOR_KEY` для HMAC cursor. В текущей topology оба значения
получает только `seo-data`; preparation/connector/Web/Platform API processes их не
получают. Это не закрывает P0 partition prototype/query-plan gate.
Representative history load test также не выполнен и остаётся последующим
release gate.

Отдельный fresh PostgreSQL 18 infrastructure proof применил все четыре Prisma
migration chains под canonical owners и подтвердил runtime CRUD, UUIDv7,
constraints, отсутствие runtime DDL/`_prisma_migrations`/membership/ownership,
cross-database и replication reject, закрытый `PUBLIC` bypass, Directus
exception и connector exact allowlist. Перед конкретным production deploy
остаются target-environment HBA order/login smoke и reviewed ownership handoff,
если volume уже содержит объекты старого owner.

#### Не входит

Публичный production, полноценный billing, все integrations и polished unified web.

### P1. Закрытая alpha: workspace → project → semantics

#### Пользовательский результат

Небольшая группа SEO-специалистов может создать workspace/project, пригласить коллег и вести реальное семантическое ядро.

#### Scope

- email/password, Google, Яндекс, Telegram auth;
- email verification, sessions, password recovery;
- базовая 2FA;
- onboarding;
- workspace/project;
- predefined roles;
- invites;
- audit важных действий;
- project settings: domain, search engine, region, language, timezone;
- semantic table;
- groups, nested groups, clusters, tags;
- target URL;
- intent;
- custom columns базовых типов;
- saved views/filters/sorts;
- inline и bulk edits;
- optimistic locking;
- presence, visible users, cell selections;
- comments/mentions;
- CSV/TSV/XLS/XLSX/ZIP import;
- Key Collector exported-file mapping;
- resumable upload;
- staging/preview/errors/rollback import;
- export;
- project notes/knowledge document;
- базовая job queue и job center;
- английский и русский UI;
- admin: users/workspaces/projects/jobs/audit;
- feature flags;
- базовые metrics/logs/backups.

#### Ограничения alpha

- ручное приглашение/allowlist;
- без системных SEO API keys;
- без публичной оплаты;
- ограниченные размеры по feature flag;
- support выполняется внутренней командой;
- guest reports отключены.

### P2. Private beta: позиции и BYOK

#### Пользовательский результат

Команда подключает собственные provider credentials, снимает позиции вручную и по расписанию, сохраняет историю и контролирует качество данных.

#### Scope

- credential vault;
- integration catalog/bindings;
- минимум два источника SERP/rank data;
- первые connector implementations: XMLStock, Arsenkin Tools и Keys.so;
- BYOK validation/test;
- tracking contexts;
- выбор keyword sets;
- manual rank check;
- schedule;
- position history;
- current positions;
- visibility and movement metrics;
- URL changes/cannibalization signals;
- SERP snapshot;
- queue fairness;
- retry/cancel/partial success;
- provider rate limiting;
- source/freshness/provenance;
- fallback между BYOK credentials при явной настройке;
- notification center;
- email, browser Web Push и Telegram notifications;
- operational provider dashboard;
- limits без платежей либо controlled beta plan;
- project dashboard v1;
- security hardening;
- E2E, load и restore testing.

В P2 XMLStock, Arsenkin Tools и Keys.so запускаются с BYOK. Platform-paid XMLStock допускается после developer/commercial согласования. Platform-paid Arsenkin и Keys.so не являются exit requirement P2.

Промежуточно реализованы encrypted workspace vault и каталог первой тройки,
create/list/rotate/revoke, masked DTO, optimistic concurrency, а также
асинхронный provider-specific validation для Arsenkin и Keys.so с
идемпотентным PostgreSQL Job, lease/retry и отдельным connector worker.
XMLStock validation остаётся заблокированным до подтверждённого provider
contract. Project binding для `SERP_RANK_TRACKING` уже реализован как
нормализованный BYOK route с tenant-safe FK, immutable idempotency receipt,
CAS/ETag, redacted outbox и project settings UI. Arsenkin предоставляет эту
capability в текущем allowlist, а существующий ключ получает её только после
успешной повторной provider validation. Binding сам по себе не запускает
provider operation. Versioned tracking context, provider-free оценка,
immutable SEO Data execution manifest и durable Jobs PREPARING runtime уже
реализованы. Внешне Jobs по-прежнему предоставляет только internal
create/get/cancel, а rank-worker дополнительно содержит не подключённый к
dispatcher/provider path grant intent/consume service. DB-first сохраняет exact
manifest command/hash, создаёт `rank_job_runs`, проверяет его
tenant/job/estimate binding перед HTTP, восстанавливает потерянные BullMQ
notifications PostgreSQL dispatcher-ом и сериализует cancel/worker через lock
order `Job → RankJobRun`. Grant service до своего HTTP сохраняет exact
`REQUESTED`, а затем фиксирует `DENIED`, `EXPIRED`,
`GRANTED_PENDING_CONSUME` либо `REJECTED_LOCAL`; валидный grant под повторной
проверкой graph атомарно создаёт secret-free
`rank_connector_executions/READY_TO_SUBMIT` и становится `CONSUMED`.
Redis producer работает bounded best effort, а DB triggers защищают exact
initial state, monotonic attempt/version и committed Job/Run/Estimate
coherence. Public Platform API routes и восстанавливаемый Web Job flow
реализованы. SEO Data уже принимает
exact normalized chunks, сохраняет append-only snapshots/current projection,
атомарно завершает successful/partial manifest с redacted outbox и
предоставляет internal keyset history. Public
`GET /api/v1/projects/:projectId/rank-history` и private/noindex Web route
`/app/projects/:projectId/rankings` уже реализованы с bounded UTC range,
optional context/keyword filters, opaque cursor/load-more и archived/read-only
states. Exact `SECURITY DEFINER` credential broker, rank claim и атомарная
pre-network submit authorization уже реализованы. Runtime provider request,
submit/status/fetch persistence, normalized result producer и schedule
остаются следующими вертикальными срезами. Оценка сохраняется в Jobs как
immutable idempotency receipt, доступна в read-only и не вызывает
провайдера, BullMQ, списание, usage, outbox или event. Профильные и
membership-bound проектные настройки уведомлений, in-app центр и
dependency-free lifecycle browser devices уже реализованы. Endpoint/browser
keys защищены AES-GCM и отдельным HMAC keyring, управление идёт через
dedicated Platform API → Realtime token, а Service Worker ограничен scope
`/app/` и не кэширует private API. Durable email/Web Push delivery ещё нет;
registration честно возвращает `deliveryAvailable=false` и
`testDeliveryAvailable=false`.
Durable identity safety leg завершён по ADR-2026-036: atomic whole-family
revoke/outbox, bounded global session-expiry sweeper, Platform API JetStream
publisher, exact provisioned topology и Realtime durable pull consumer с
commit-before-ack, bounded retry и redacted DLQ. Realtime сохраняет scoped
inbox/tombstone, terminal-отзывает devices и fail-closed защищает upsert.

Следующий notification-срез должен провести остальные redacted domain events
через effective policy в идемпотентные delivery attempts и добавить отдельный
sender role с VAPID private key, `web-push`, собственные delivery retry/DLQ,
digest и delivery history. P2 не считается выполненным до реального rank job,
multi-tenant queue fairness, фактической внешней notification delivery и
security/load/restore gates.

Межсервисный hardening уже удалил legacy `INTERNAL_API_TOKEN`, разделил
четыре general caller/audience credentials и сохранил отдельные vault,
notification и rank boundaries. Compose запускает network-less read-only
one-shot `service-token-preflight` до credential-bearing processes и NATS:
девять service tokens, `RANK_HISTORY_CURSOR_KEY`, восемь Redis passwords и
четыре NATS passwords
должны быть глобально pairwise distinct, без placeholders и соответствовать
deploy-алфавиту `[A-Za-z0-9._~-]` при длине `32..512`; четыре соответствующих
bcrypt verifier записи с cost `11` и четыре NATS usernames проверяются отдельно, а
broker не получает plaintext client passwords. Runtime намеренно сохраняет
более широкий HTTP-контракт
visible ASCII без whitespace/control/comma. Jobs HTTP,
import, inspection, system, rank и connector используют отдельные process
roles/env allowlists. Эти gates уменьшают secret fan-out и ошибку конфигурации,
но не закрывают P2: остаются provider runtime, durable delivery, egress,
observability, target-environment rollout и load/restore evidence.

Redis hardening теперь разделяет Jobs, Realtime и Directus на три
internal-only instance/network. Jobs использует AOF + `noeviction` и шесть
queue-scoped users с versioned BullMQ keyspaces; Realtime получает только
versioned Socket.IO Pub/Sub channels namespace `/collaboration` без key access,
а root namespace остаётся in-memory; Directus имеет отдельный ephemeral cache
user. Default user выключен, health user ограничен `PING`, ACL
и runtime config атомарно готовятся в owner-correct tmpfs с password hashes.
Source-built Redis 8.8.1 live smoke 3/3 подтверждает BullMQ, ACL, Pub/Sub и
cache command boundary; exit gate всё ещё требует startup pinned
Redis/Directus images на Docker-host, representative AOF memory/load evidence,
memory/ACL/latency alerts и reviewed drain/migration старого `redis_data` без
удаления данных.

Preparation runtime имеет bounded `maxAttempts=20`. До internal seal вызова
sidecar переходит в `OUTCOME_UNKNOWN`; только доказанное отсутствие manifest
разрешает `NOT_SEALED`. Retryable transport/service ambiguity повторяет exact
идемпотентную seal/finalize command в пределах budget; non-retryable
ambiguity или исчерпание attempts завершают Job как
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`. Provider submit в этом runtime ещё
отсутствует и автоматически не resubmit-ится.
SEO Data protected result boundary уже идемпотентно принимает normalized
chunks, сохраняет ingest receipts, append-only snapshots/current projection и
после полного принятого набора атомарно finalizes successful/partial manifest
с redacted completion outbox. Zero-persisted
`CANCELLED/FAILED/ACTION_REQUIRED` также сохраняют immutable finalize receipt.
Provider-side producer этих normalized chunks/receipt acknowledgements ещё не
реализован. Public/admin reconcile/acknowledge API, UI и политика безопасного
resolution для terminal `ACTION_REQUIRED` ещё не реализованы.

Realtime identity gate включает durable revoked-family tombstone, scoped inbox
receipt, fail-closed проверку tombstone в device upsert и durable pull
subscription; он реализован и тестирует оба порядка `registration → event` и
`event → delayed registration`. Полный exit gate всё ещё требует PostgreSQL
18 concurrency/rollback и target-volume sweeper smoke, NATS operational
alerts/replay evidence и backup/restore; update только существующих devices
не принимается из-за resurrection race.

Перед первым provider submit jobs/integrations должен повторно проверить
workspace/project lifecycle и billing. Текущая проверка mutation в Platform
API оставляет межсервисное TOCTOU до commit отдельной jobs database; требуется
authoritative lifecycle projection/inbox либо эквивалентная precondition.
Project binding migration проверена на PostgreSQL 16. Новая migration
immutable `rank_estimates` и Jobs preparation migrations прошли
schema/static review и fresh full-chain deploy на PostgreSQL 15. SEO Data
rank manifest/finalization migrations также прошли локальный PostgreSQL 15
smoke. В PostgreSQL 15 использовался test-only совместимый `uuidv7()` shim;
это не является target-version evidence. Для обоих владельцев PostgreSQL 18
fresh/negative tests и реальные
конкурентные `claim ↔ cancel ↔ seal/finalize` гонки остаются release gates.
Jobs migration fail-closed проверяет legacy manual rows/active dedup
conflicts; первый rollout требует worker drain/maintenance window для
обычного unique-index rebuild, а large live database — отдельный
expand/concurrent-index план.
Migrations `20260729230100_rank_execution_grant_attempts`,
`20260729230200_rank_connector_executions`, scoped claim, split
`SUBMITTING` enum и submit authorization имеют schema/static coverage,
tenant-safe JobItem hardening и deferred atomic consume invariant. Fresh
full-chain apply, grant/consume negative/concurrency, claim/reclaim/stale-head/
drift, upgrade ACL и authorize/replay/rollback/expiry races пройдены на
PostgreSQL 18. Exact provisioning script уже не выдаёт direct table DML;
fresh cluster-wide service-role/`pg_hba` proof пройден. Target-environment
HBA/login smoke, rollout старых sessions/roles и provider lifecycle races
остаются release gates.
Target runtime — Node.js 24; текущий полный lint/typecheck/test/build baseline
проверен на Node.js 24.18.1.

Архитектура первого Arsenkin manual rank job зафиксирована
ADR-2026-034. Provider-free estimate и exact execution contracts из ADR уже
реализованы; immutable SEO Data manifest, protected result ingest/finalize,
durable Jobs preparation, public/Web Job lifecycle, normalized SEO Data
history/outbox и public history API/UI готовы. Jobs bounded grant client и
durable intent/decision history тоже реализованы; atomic
`CONSUMED ↔ READY_TO_SUBMIT`, scoped credential broker, claim и атомарный
`CLAIMED → SUBMITTING` foundation готовы, но provider request/status runtime и
normalized result producer ещё отсутствуют. Platform API issuer foundation сохраняет
immutable exact 30-секундные decisions под lifecycle/RBAC locks, production
policy остаётся fail-closed, а Jobs не выдаёт credential или provider action;
это ещё не provider execution. Live `set` остаётся выключенным до recorded
one-key contract или письменного подтверждения response/status/retry
semantics, producer-side обработки ingest receipts, durable
`SUBMIT_OUTCOME_UNKNOWN` без auto-resubmit и production environment evidence.
Наличие working
credential validation и capability в binding не считается доказательством рабочего
`positions` execution.

До production rollout BYOK дополнительно блокируют две границы текущего
validation slice:

- `keyVersion` immutable, а смена active выполняется только после expand,
  startup decrypt-canary проверки точного key material всех используемых
  версий и drain старых replicas. Такой canary теперь запускается до создания
  queue worker на каждой `EXECUTION` replica и проверяет один persistent
  authenticated sample каждой реально используемой версии; missing/corrupt
  sample останавливает startup. Decrypt failure после startup даёт job-only
  bounded retry без изменения credential. До beta ещё нужны cluster-wide
  circuit breaker и incident alert для runtime-всплеска;
- широкий `SELECT` execution DB role должен быть устранён: до exit gate
  используется узкая execution projection/table с server-side scope либо
  credential broker/KMS, а также пройдены cluster-wide grant audit и
  `pg_hba`/cluster isolation.

#### Промежуточная приёмка durable preparation

- internal create/get/cancel проходят exact tenant и idempotency checks;
- exact manifest command/hash записаны до HTTP/BullMQ;
- queue loss и истёкший lease восстанавливаются PostgreSQL dispatcher-ом;
- только `PENDING + attempt=0` cancel немедленно даёт
  `NOT_SEALED/CANCELLED`; `OUTCOME_UNKNOWN/SEALED` сначала дают
  `CANCEL_REQUESTED`, затем exact recovery завершает доказанным
  `NOT_SEALED/CANCELLED`, `FINALIZED/CANCELLED` либо `ACTION_REQUIRED`;
- retryable seal/finalize ambiguity повторяется exact в bounded budget, а
  non-retryable ambiguity и 20 исчерпанных attempts дают
  `ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`;
- готовые public Job/history read routes и Web UI сами по себе не объявляют
  provider execution готовым.

#### Промежуточная приёмка execution grant intent/consume

- dedicated Jobs → Platform token получают только Platform API и rank-worker;
  generic Jobs HTTP и остальные workers/processes его не получают;
- до issuer HTTP в PostgreSQL записывается exact `REQUESTED` с immutable
  request/scope/evidence hashes и stable idempotency key;
- retryable ambiguity повторяет сохранённый request, а решение под canonical
  locks и DB clock становится `DENIED`, `EXPIRED`,
  `GRANTED_PENDING_CONSUME` либо `REJECTED_LOCAL`;
- валидный grant атомарно получает `CONSUMED` только вместе с единственной
  secret-free `READY_TO_SUBMIT` execution row; deferred invariant запрещает
  commit любой половины;
- dispatcher/provider path service не вызывает; default-closed
  `SECURITY DEFINER` claim/authorize и exact connector grants существуют, но
  runtime caller ещё не подключён к scoped role, а production submit
  fail-closed выключен;
- PostgreSQL 18 fresh/negative/race и upgrade ACL tests для
  intent/consume/claim/authorize пройдены; target-environment login/rollout и
  provider lifecycle evidence остаются обязательными;
- приёмка этого slice не закрывает подключение connector runtime к scoped
  role, provider contract, normalized producer, vault isolation и production
  security gates.

#### Промежуточная приёмка public history read

- `GET /api/v1/projects/:projectId/rank-history` требует session,
  `ranking.view` и tenant scope, но сохраняет чтение archive/read-only;
- canonical UTC range использует inclusive `observedFrom` и exclusive
  `observedBefore`, optional UUIDv7 context/keyword, limit `1..200` и opaque
  cursor; array/unknown query отклоняются;
- Platform API fail-closed валидирует/redact-ит scope, filters, order,
  duplicates и page coherence ответа SEO Data;
- private/noindex Web route предоставляет filters, loading/empty/error/offline,
  load-more и read-only states;
- приёмка read slice не закрывает provider execution, partitioning и
  representative load-test gates.

#### Exit gate

- несколько пилотных команд используют платформу для реального регулярного tracking;
- нет потерь истории при retry/duplicate delivery;
- provider outage корректно деградирует;
- monthly infrastructure/provider cost измерим;
- очередь не допускает starvation между tenants;
- security review пройден.

### P3. Публичный SaaS: биллинг и системные ключи

#### Пользовательский результат

Пользователь регистрируется самостоятельно, выбирает тариф, использует BYOK или системный API-бюджет, заранее видит стоимость и получает документы по оплате.

#### Scope

- public signup;
- plan catalog;
- стартовые планы Trial/Solo/Team/Agency/Business/Enterprise;
- subscription;
- trial/promo;
- payment provider;
- ЮKassa adapter, автоплатежи и возвраты;
- НПД receipt workflow для текущего статуса самозанятого;
- ручная регистрация чека ЮKassa-платежа через «Мой налог» и доставка клиенту;
- 54-ФЗ/фискализация только после смены статуса и заключения бухгалтера;
- invoices/receipts по применимой модели;
- workspace usage;
- limits/add-ons;
- balance/top-up;
- immutable ledger;
- reservation/settlement/refund;
- price book;
- platform credentials;
- provider routing;
- estimate before run;
- per-job actual cost;
- workspace/project budgets;
- insufficient balance states;
- grace/dunning;
- billing admin/reconciliation;
- единый `platform-web`: публичный сайт и защищённый `/app`;
- Directus;
- pricing/features pages;
- статьи и индексируемый стартовый Toolbox;
- `/docs/api` и generated OpenAPI reference;
- базовые scoped API tokens во всех платных тарифах;
- localized SEO metadata;
- forms/lead capture;
- docs/help minimum;
- status page;
- production monitoring/on-call;
- deletion/export/privacy flows.

Публичный российский checkout может запускаться с ЮKassa. До активного привлечения платящих клиентов за пределами поддерживаемой географии должен быть выбран второй payment adapter либо Merchant of Record.

#### Exit gate

- duplicate payment/provider/webhook tests проходят;
- ledger invariant подтверждён reconciliation;
- системный provider spend ограничен hard budgets;
- Terms/Privacy/DPA опубликованы;
- support/runbooks готовы;
- публичные тарифы совпадают между billing API, приложением, сайтом и checkout;
- production restore drill успешен.

### P4. Семантическая аналитика и расширенный сбор

#### Пользовательский результат

Платформа заменяет значительную часть ручной работы с частотностями, Wordstat, SERP, подсказками и группировкой запросов.

#### Scope

- Wordstat integration;
- frequency types and history;
- search suggestions;
- related queries;
- competitor keyword import;
- clustering;
- cluster evidence/intersection;
- group/cluster versioning;
- advanced custom columns/formulas;
- duplicate/normalization tools;
- stop words;
- geo and device variants;
- automated collections;
- Magnet: GSC/Webmaster/GA4/Метрика → staging → dedup → semantic publish;
- provider fallback chains;
- expanded integrations: Keys.so, XMLRiver, XMLStock, Arsenkin и выбранные международные аналоги;
- cost optimization/routing;
- semantic versions and rollback;
- richer charts and cohort comparisons;
- automation builder v2.

### P5. Страницы, конкуренты, аудит и отчёты

#### Пользовательский результат

Команда связывает семантику со структурой сайта, находит gaps/cannibalization, анализирует конкурентов и отдаёт клиенту понятный отчёт.

#### Scope

- competitor domains;
- overlap/gaps;
- competitor pages;
- page map;
- query → cluster → page;
- missing landings;
- cannibalization workflow;
- page status/tasks/owners;
- content brief;
- knowledge/files;
- technical crawler;
- Radar с настраиваемым interval/speed, polite per-host limits и page diffs;
- sitemap generator/versioning/submission;
- audit issues;
- Google Search Console;
- GA4;
- Яндекс Вебмастер;
- Яндекс Метрика;
- dashboard builder;
- report builder;
- report snapshots;
- guest share links;
- client role;
- white label without custom domain;
- scheduled email/report delivery;
- PDF/CSV/XLSX exports.

### P6. Agency/enterprise maturity

#### Scope

- custom roles;
- SCIM/SAML SSO при подтверждённом спросе;
- advanced service accounts, higher API quotas и IP allowlists;
- advanced audit export;
- approval workflows;
- workspace templates;
- bulk project operations;
- advanced retention;
- legal hold;
- enterprise SLA/support;
- regional deployments/data residency при бизнес-необходимости;
- WebAuthn/passkeys;
- advanced anomaly/security controls;
- integration marketplace/process;
- higher availability infrastructure;
- disaster recovery automation.

### P7. AI-assisted workflows

AI вводится только при наличии provenance и human confirmation.

Возможности:

- suggestion кластера;
- intent suggestion;
- page mapping;
- content gap summary;
- brief draft;
- anomaly explanation;
- automation recommendation;
- natural-language filters/actions с preview.

Требования:

- evidence/source рядом с предложением;
- confidence;
- manual apply;
- undo;
- отсутствие скрытого списания;
- PII/provider-data policy;
- prompt/output audit в допустимом объёме;
- защита от prompt injection в импортированном контенте;
- модель/стоимость/retention прозрачны.

## 4. Рекомендуемый состав команды

Минимальная команда, способная последовательно довести P0–P3:

- product owner/domain expert;
- product designer;
- tech lead/architect;
- 2 frontend engineers;
- 2 backend engineers;
- 1 engineer с фокусом на data/workers/integrations;
- QA automation;
- DevOps/SRE part-time с ростом нагрузки;
- security/legal review по этапам;
- content/marketing до публичного запуска.

Один разработчик может построить прототип, но не должен обещать одновременно production-grade billing, international compliance, 5-миллионные таблицы, десятки миллионов snapshots и круглосуточную эксплуатацию без существенного сокращения scope.

## 5. Рабочие потоки

Backlog ведётся по потокам:

1. Identity, workspace, permissions.
2. Project shell и design system.
3. Semantics/import.
4. Jobs/integrations.
5. Rank/frequency data.
6. Collaboration/reports.
7. Billing.
8. Marketing/Directus.
9. Admin/support.
10. Platform/security/observability.

Каждый product increment должен содержать platform/security work, а не откладывать его на финал.

## 6. Requirements traceability

Каждое требование в task tracker получает:

- requirement ID вида `SEM-IMP-001`;
- ссылку на раздел ТЗ;
- user story/use case;
- design link;
- API contract;
- data migration;
- permissions;
- analytics events;
- acceptance tests;
- release flag;
- документацию.

Рекомендуемые префиксы:

- `AUTH`;
- `WS`;
- `PROJ`;
- `SEM`;
- `IMP`;
- `RANK`;
- `FREQ`;
- `SERP`;
- `COMP`;
- `PAGE`;
- `AUDIT`;
- `JOB`;
- `INT`;
- `AUTO`;
- `COLLAB`;
- `REPORT`;
- `BILL`;
- `SITE`;
- `CMS`;
- `ADMIN`;
- `SEC`;
- `OPS`.

## 7. Общие критерии приёмки экрана

Для каждого экрана проверяются:

- route и breadcrumb;
- title/metadata;
- permission denied;
- loading;
- initial empty;
- filtered empty;
- success;
- stale data;
- partial data;
- recoverable error;
- fatal error;
- offline/reconnecting;
- read-only;
- suspended/archived;
- plan locked;
- quota/balance exhausted;
- responsive layout;
- keyboard navigation;
- screen reader basics;
- `en`/`ru`;
- timezone/number/date formatting;
- analytics events;
- audit для mutations;
- browser back/forward;
- deep link;
- unsaved changes;
- optimistic update rollback;
- conflict state;
- slow network.

## 8. Общие критерии приёмки сущности

Для каждой сущности:

- create/read/update/archive/delete semantics;
- ID and tenant scope;
- timestamps;
- actor;
- version;
- validation;
- unique constraints;
- permissions;
- audit;
- pagination/filter/sort;
- import/export eligibility;
- retention;
- event emission;
- API error codes;
- admin visibility;
- fixtures/tests;
- migration/backfill.

## 9. Сквозные acceptance scenarios

### AC-01. Международная регистрация

**Дано:** новый пользователь с локалью `en`.  
**Когда:** регистрируется через email/password.  
**Тогда:**

- принимает актуальные Terms/Privacy;
- получает verification;
- создаёт сессию только по правилам security;
- выбирает timezone/country;
- видит английский onboarding;
- даты хранятся UTC;
- audit/security events созданы.
- конкурентный password reset не позволяет login или MFA challenge со старым
  user/password snapshot создать сессию после reset commit;
- terminal logout/revoke/reset создаёт ровно одно redacted outbox event на
  каждую реально отозванную session family.
- просроченная refresh family terminal-отзывается bounded global sweeper даже
  без нового client refresh; повторный due scan не создаёт duplicate event;
- Realtime применяет exact event одной локальной транзакцией и source ack
  возможен только после committed inbox/tombstone/device revoke; permanent
  failure не теряется без подтверждённого DLQ PubAck.

Повторяется для Google, Яндекс и Telegram с безопасным linking.

### AC-02. Командный workspace

Owner создаёт workspace, приглашает Admin, SEO Specialist и Client.

Проверяется:

- invitation lifecycle;
- истечение/отзыв;
- project restrictions;
- Client не видит credentials, costs и внутренние notes;
- SEO Specialist не меняет billing без permission;
- последнего Owner нельзя удалить;
- изменения ролей отражаются в активной сессии/realtime.

### AC-03. Проект

Пользователь создаёт проект с доменом, search engine, locale, region, timezone.

Проверяется:

- нормализация домена;
- duplicate policy;
- wizard resume;
- cancel;
- template;
- dashboard empty state;
- archive/restore;
- scheduled jobs pause on archive.

### AC-04. Key Collector import

Пользователь загружает 2–5 GB export archive.

Проверяется:

- resumable multipart;
- checksum;
- scanning;
- encoding/delimiter/sheet detection;
- preview;
- mapping;
- saved import preset;
- groups/columns/values preserved;
- custom column creation;
- duplicate strategy;
- invalid rows report;
- cancel;
- failure resume/retry;
- atomic publish или документированная chunk visibility;
- version/undo;
- source provenance;
- export roundtrip на выбранных полях.

### AC-05. Одновременная работа

Два пользователя открывают одно semantic view.

Проверяется:

- presence/avatar;
- курсор/selection;
- throttle;
- скрытые колонки не раскрываются;
- разные ячейки сохраняются;
- одна ячейка создаёт controlled conflict;
- reconnect/resync;
- permission revoked disconnect;
- таблица не блокируется глобальным pessimistic lock.

### AC-06. BYOK rank check

Пользователь добавляет provider key, проверяет его и запускает tracking.

Проверяется:

- plaintext не возвращается;
- capability/limit shown;
- estimate с нулевой platform provider cost либо service fee по тарифу;
- idempotent start;
- provider rate limiting;
- retry;
- потерянный/неоднозначный submit не повторяется автоматически и показывает
  `SUBMIT_OUTCOME_UNKNOWN`;
- positions/history/source/date/region/device;
- partial results;
- credential disabled state;
- no platform key fallback without consent.

### AC-07. Platform-key rank check

У пользователя нет собственного ключа.

Проверяется:

- estimate;
- тарифный allowance;
- balance reservation;
- provider route;
- actual settlement;
- refund unused reservation;
- per-job cost;
- insufficient balance state;
- duplicate command/webhook не списывает повторно;
- hard budget stops new work.

### AC-08. Scheduled tracking

Пользователь настраивает schedule в локальной timezone.

Проверяется:

- DST;
- next run preview;
- overlap policy;
- missed run policy;
- pause/resume;
- budget limit;
- provider outage/fallback;
- notification;
- audit;
- archived project blocks execution.

### AC-09. Частотность/Wordstat

Пользователь выбирает keyword set и типы частотности.

Проверяется:

- region/type/source;
- async progress;
- provider limits;
- history;
- freshness;
- partial results;
- cost;
- filter by missing/stale;
- retry only failed items.

### AC-10. Page map

Пользователь назначает clusters на pages.

Проверяется:

- one primary mapping rules;
- conflict/cannibalization;
- missing landing;
- bulk assignment;
- version history;
- undo;
- role permissions;
- evidence links to SERP/overlap.

### AC-11. Guest report

Пользователь публикует snapshot.

Проверяется:

- snapshot immutable;
- token entropy;
- expiry/password/revoke;
- white-label logo/colors;
- no custom domain;
- no internal notes/costs;
- robots `noindex`;
- download permission;
- rate limiting;
- view audit/analytics в privacy-safe виде.

### AC-12. Directus publication

Editor создаёт локализованную страницу из разрешённых blocks.

Проверяется:

- draft/preview/publish;
- `en`/`ru` fallback policy;
- canonical/hreflang;
- SEO fields;
- redirects;
- version rollback;
- invalid block configuration rejected;
- pricing block получает значения из billing source of truth;
- content change не выполняет application-admin action.

### AC-13. Support session

Support agent открывает workspace в ограниченном режиме.

Проверяется:

- ticket/reason;
- approval/step-up;
- visible banner;
- time limit;
- read-only default;
- no secrets;
- full audit original/effective actor;
- immediate revoke.

### AC-14. Account/project deletion

Проверяется:

- reauthentication;
- consequence preview;
- grace period;
- scheduled jobs disabled;
- active exports/links revoked;
- restoration within grace;
- irreversible cleanup after grace;
- ledger/audit preserved as required;
- backups expire according to policy;
- completion notification.

### AC-15. Provider outage

Provider возвращает timeouts/429/5xx.

Проверяется:

- error classification;
- circuit breaker;
- bounded retries;
- Retry-After;
- allowed fallback;
- cost ceiling;
- no duplicate results/charges;
- partial state;
- user explanation;
- operational alert.

### AC-16. Disaster recovery

Staging game day имитирует потерю основной базы.

Проверяется:

- обнаружение;
- restore из backup/PITR;
- RPO;
- RTO;
- event/queue reconciliation;
- missing objects check;
- documented timeline;
- corrective actions.

### AC-17. Единый web и индексация

Проверяется:

- public pages, articles, `/tools` и `/docs/api` доступны на основном домене;
- `/app` требует сессию;
- `/app` отсутствует в sitemap и public search;
- HTML metadata и `X-Robots-Tag` содержат noindex/nofollow;
- tenant response имеет private/no-store и не попадает в public cache;
- public tool landing индексируем, временный user result — нет;
- Directus outage использует stale public cache и не блокирует `/app`.

### AC-18. Public/project Toolbox и API parity

Проверяется:

- capability имеет один code/schema/domain handler;
- public, project UI и API используют одинаковую validation;
- anonymous limits и low-priority queue соблюдаются;
- платный запуск требует estimate/approval/reservation;
- public result можно явно сохранить в доступный проект;
- API доступен на Solo и любом старшем платном тарифе;
- API docs и OpenAPI соответствуют реализации.

### AC-19. Radar и sitemap

Проверяется:

- interval, speed, concurrency, scope и quiet window сохраняются;
- robots и per-host token bucket соблюдаются;
- 429/503/latency включают backoff и снижение нагрузки;
- один tenant не блокирует API или jobs других tenants;
- unchanged URL использует conditional request/skip;
- page snapshot и field diff воспроизводимы;
- sitemap исключает non-canonical/non-indexable/error URL;
- более 50 000 URL разбиваются через sitemap index;
- version/download/diff/submission работают.

### AC-20. Magnet

Проверяется:

- GSC/Webmaster/GA4/Метрика сохраняют отдельный provenance;
- staging отмечает new/existing/conflict;
- повторный sync не создаёт дубли;
- partial provider failure сохраняет остальные результаты;
- preview показывает фактически импортируемые поля;
- publish создаёт semantic version и mapping результата.

### AC-21. ЮKassa и чек НПД

Проверяется:

- только verified YooKassa `succeeded` создаёт obligation;
- duplicate webhook не создаёт второй чек;
- gross amount совпадает с платежом до комиссии;
- ручная регистрация требует MFA/audit и официальный receipt ID/URL;
- чек доставляется клиенту и виден в billing history;
- reconciliation находит successful payment без obligation;
- полный refund создаёт cancellation task;
- partial refund требует replacement workflow;
- credentials «Мой налог» нигде не сохраняются;
- API чеков ЮKassa по 54-ФЗ не используется для самозанятого.

## 10. Модульная матрица приёмки

| Модуль | Обязательный happy path | Обязательные отказные случаи |
|---|---|---|
| Auth | вход и refresh | неверный пароль, revoked session, provider error |
| Workspace | invite/member/role | expired invite, last owner, insufficient permission |
| Project | create/configure/archive | duplicate domain rule, invalid locale, archived mutation |
| Semantics | view/edit/bulk | conflict, large filter, deleted reference |
| Import | upload/map/publish | corrupt file, bad encoding, quota, partial parse |
| Rankings | manual/scheduled/history | provider limit, no balance, partial result |
| Integrations | add/test/use/rotate | invalid/revoked key, missing capability |
| Automations | schedule/run/notify | overlap, DST, budget, paused dependency |
| Reports | build/snapshot/share | expired/revoked token, stale source |
| Billing | subscribe/reserve/settle | duplicate webhook, decline, insufficient balance |
| NPD receipt | YooKassa success/register/deliver | duplicate webhook, missing manual receipt, refund/replacement |
| Toolbox/API | public/project/API parity | abuse limit, unauthenticated paid run, schema mismatch |
| Radar/sitemap | polite run/diff/generate | host backoff, partial crawl, invalid URL set |
| Magnet | sync/preview/publish | partial provider failure, duplicate/conflict |
| CMS | draft/preview/publish | invalid locale/block/SEO configuration |
| Admin | search/support/action | missing reason/MFA, forbidden secret access |

## 11. Data acceptance

Перед переходом к public beta используются representative datasets:

- 10 workspaces;
- 100 projects;
- один project с 5 млн keywords;
- несколько projects с 100 тыс. tracked keywords;
- сотни миллионов synthetic rank snapshots либо эквивалентный partition test;
- imports от малых до 5 GB;
- nested groups;
- сотни custom columns в стрессовом сценарии;
- concurrent edits;
- provider responses с duplicates/missing/invalid data.

Проверяется:

- query latency;
- index/partition size;
- migration duration;
- import throughput;
- memory ceiling;
- export throughput;
- backup/restore;
- queue fairness;
- UI responsiveness.

## 12. Security release gates

До P1:

- threat model;
- auth/session review;
- tenant negative tests;
- secret scanning;
- encrypted credentials prototype.

До P2:

- external или независимый application security review;
- import/SSRF testing;
- logging redaction;
- backup restore;
- incident runbooks;
- KEK startup canary/verifier или эквивалентный global decrypt-failure circuit
  breaker проверен fault-injection тестом;
- connector execution DB/KMS boundary не допускает global read multi-tenant
  jobs и BYOK vault; cluster-wide grants и `pg_hba` проверены.
- все backend migration owners отделены от application runtimes; fresh
  PostgreSQL 18 и target-environment smoke подтверждают отсутствие runtime
  DDL, ownership/membership, `PUBLIC`, `_prisma_migrations`, cross-database и
  replication bypass;
- на PostgreSQL 18 пройдены реальные race tests `rotate ↔ rotate`,
  `login ↔ password reset`,
  `MFA challenge/confirm/disable ↔ password reset`, а также
  rollback terminal revoke при ошибке outbox;
- на PostgreSQL 18 пройдены manual rank races
  `claim ↔ cancel ↔ persist/finalize`, negative trigger tests и recovery
  после потерянного BullMQ notification;
- на PostgreSQL 18 пройдены grant-intent races
  `request ↔ exact replay ↔ decision/expiry ↔ consume` и negative tenant/
  state-matrix tests;
- все production packages собраны и проверены на Node.js 24; локальный
  Node.js 22 engine warning этот gate не заменяет.

In-memory unit test не заменяет перечисленные PostgreSQL concurrency gates.

До P3:

- penetration test;
- payment/ledger review;
- privacy/legal review;
- dependency/container scanning enforced;
- admin/support audit;
- deletion/export flows;
- production access policy.

Critical vulnerability блокирует release. High vulnerability блокирует release, кроме формально принятого краткосрочного исключения с compensating controls.

## 13. UX/design deliverables

Для каждого P1–P5 до разработки функции:

- user flow;
- low/high-fidelity screens;
- desktop/tablet/mobile behavior;
- component states;
- copy in source locale;
- `en`/`ru` translations;
- accessibility annotations;
- permission variants;
- empty/error/loading/offline;
- cost/quota states;
- destructive confirmation;
- analytics spec.

Design QA выполняется на staging, а не только по макету.

## 14. Documentation deliverables

До public launch:

- getting started;
- project setup;
- import format/Key Collector guide;
- tracking setup;
- BYOK guides;
- provider capability/limitations;
- billing/usage explanation;
- roles/permissions;
- reports/client access;
- API documentation;
- status/incidents;
- privacy/security overview;
- data export/deletion;
- troubleshooting;
- release notes.

## 15. Go-live checklist P3

### Product

- onboarding завершает core action;
- demo/sample project;
- upgrade/downgrade/cancel;
- support channel;
- user-facing docs;
- localized transactional messages.

### Engineering

- production infra versioned;
- backups/PITR;
- restore test;
- monitoring/alerts;
- load test;
- migrations rehearsed;
- rollback/runbook;
- on-call;
- status page.

### Security/legal

- Terms/Privacy/DPA;
- cookie consent;
- subprocessor list;
- security contacts;
- penetration test findings closed/accepted;
- admin MFA;
- least-privilege production access.

### Finance/operations

- payment account;
- taxes/invoice process;
- refunds;
- provider balances/alerts;
- unit economics dashboard;
- reconciliation;
- abuse/fraud response.

### Marketing

- domain chosen;
- DNS/email authentication;
- localized landing/pricing;
- canonical/hreflang/sitemap/robots;
- Directus workflow;
- analytics consent;
- lead/contact routes.

## 16. Post-launch success metrics

Измеряются:

- activation: workspace + project + import/first keyword set;
- time to first value;
- first successful rank/frequency collection;
- weekly active workspaces;
- scheduled-job retention;
- import success and error rate;
- percentage BYOK/platform usage;
- gross provider cost and margin;
- queue delay;
- data freshness;
- report sharing/client views;
- trial-to-paid;
- churn;
- support tickets by module;
- incident/SLO;
- security/privacy requests.

Метрики не должны собирать содержимое keywords/pages без явной продуктовой необходимости.

## 17. Out of scope до отдельного решения

- нативные mobile apps;
- desktop Key Collector plugin;
- чтение закрытого нативного формата проекта Key Collector;
- агентские custom domains;
- собственная глобальная поисковая прокси-сеть;
- хранение платёжных карт;
- полноценный site builder;
- unrestricted custom code/formulas;
- обещание конкретного data residency;
- автоматическая публикация изменений на сайт клиента;
- autonomous AI actions без preview/approval;
- сотни отдельных микросервисов.

## 18. Финальная приёмка целевой версии

Целевая версия считается принятой, когда:

- реализованы согласованные этапы;
- все critical user journeys проходят E2E;
- role matrix подтверждена automated tests;
- приложение устойчиво работает на согласованном representative load;
- imports и exports сохраняют документированные значения;
- позиционная и частотная история корректно версионирована;
- collaboration не приводит к silent overwrite;
- billing ledger сходится;
- BYOK/platform modes прозрачны;
- сайт, Directus и app-admin разделены по полномочиям;
- API/contracts опубликованы и совместимы;
- SLO/backup/security gates выполнены;
- документация и runbooks переданы;
- известные ограничения перечислены в release notes.
