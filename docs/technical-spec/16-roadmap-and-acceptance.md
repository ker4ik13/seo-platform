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
- email/Telegram notifications;
- operational provider dashboard;
- limits без платежей либо controlled beta plan;
- project dashboard v1;
- security hardening;
- E2E, load и restore testing.

В P2 XMLStock, Arsenkin Tools и Keys.so запускаются с BYOK. Platform-paid XMLStock допускается после developer/commercial согласования. Platform-paid Arsenkin и Keys.so не являются exit requirement P2.

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
- incident runbooks.

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
