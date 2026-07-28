# Безопасность, качество и эксплуатация

## 1. Цели

Платформа должна:

- изолировать данные рабочих областей;
- защищать учётные, платёжные и интеграционные данные;
- сохранять управляемость при частичных отказах внешних SEO API;
- обеспечивать проверяемые релизы и восстановление;
- соответствовать ожиданиям международного B2B SaaS;
- давать команде эксплуатации достаточно информации без раскрытия секретов.

Юридические формулировки privacy policy, DPA, retention и международной передачи данных подлежат проверке профильным юристом до production-релиза.

## 2. Модель угроз

До начала реализации создаётся threat model, обновляемый минимум для каждого крупного релиза.

Обязательные сценарии:

- доступ пользователя workspace A к данным workspace B;
- повышение роли через подмену ID или mass assignment;
- кража session/token;
- credential stuffing и brute force;
- OAuth account confusion/linking attack;
- утечка BYOK/provider credentials;
- повтор платежного webhook;
- повтор платной команды;
- вредоносный импорт, formula injection и zip bomb;
- stored/reflected XSS через ключевые слова, страницы, rich text и Directus;
- SQL/NoSQL/command injection;
- SSRF через crawler, webhook, favicon, URL preview и redirects;
- DNS rebinding;
- CSV injection при экспорте;
- path traversal;
- object storage enumeration;
- supply-chain compromise;
- malicious insider/support access;
- queue flooding и balance exhaustion;
- WebSocket room enumeration;
- утечка через логи, traces, error reporting или analytics;
- insecure deletion/backup retention;
- denial of service через тяжёлые фильтры, regex, exports и realtime events.

Для угроз фиксируются likelihood, impact, controls, owner и остаточный риск.

## 3. Tenant isolation

### 3.1. Обязательные правила

- Каждый tenant resource связан с `workspace_id`.
- Project resource дополнительно связан с `project_id`.
- Workspace/project context строится сервером из проверенного membership.
- Клиентский `workspaceId` никогда не считается доказательством доступа.
- Repository methods требуют явный tenant context.
- Admin и support используют отдельные endpoint и permissions.
- Background job содержит подписанный/проверяемый tenant context.
- Cache key включает tenant и permission-sensitive variation.
- Search index, object path, WebSocket room и export manifest включают tenant scope.
- Cross-tenant joins запрещены, кроме специально спроектированной platform-admin аналитики.

### 3.2. Проверка

Автоматические negative tests должны пытаться:

- читать, менять и удалять чужой resource;
- подставлять чужой ID во вложенные связи;
- скачивать чужой файл;
- подключаться к чужой realtime room;
- использовать cursor/filter snapshot другого workspace;
- повторять signed URL после отзыва;
- получать чужие данные из global search.

Ни один tenant leak не допускается как известный defect production-релиза.

## 4. Identity и account security

- Пароли хэшируются Argon2id с параметрами, измеренными на production-классе CPU.
- Минимальная длина пароля: 12 символов; максимальная достаточна для passphrase.
- Искусственные composition rules не обязательны; проверяется список известных утечек безопасным методом.
- Login response не раскрывает наличие email.
- Rate limiting использует IP, account fingerprint и risk signals.
- Email verification обязательна до чувствительных действий.
- 2FA: TOTP и recovery codes; WebAuthn/passkeys предусматриваются следующим этапом.
- Recovery codes хранятся только в hash form и показываются один раз.
- Workspace может требовать 2FA для всех участников.
- Reauthentication требуется для изменения email, пароля, MFA, credentials, billing и удаления.
- Все активные сессии видны пользователю и могут быть отозваны.
- Изменение пароля/компрометация отзывает token family.
- Подозрительный вход создаёт security event и уведомление.
- Удалённый, suspended или deactivated account не может обновить access token.

## 5. OAuth и Telegram

- Используются Authorization Code + PKCE и `state`.
- OIDC `nonce` проверяется.
- Redirect URI задаётся allowlist, без wildcard.
- Provider subject, а не email, является ключом identity.
- Автоматическое связывание identity по совпавшему email разрешается только при достоверном `email_verified` и явной безопасной политике.
- В неоднозначном случае пользователь подтверждает связь через существующую сессию.
- Telegram auth проверяется согласно актуальному официальному flow и не доверяет клиентским user fields без проверки token/id_token.
- OAuth tokens шифруются и хранятся только при необходимости последующих API-вызовов.
- Scope минимален и показывается пользователю.
- Disconnect provider запрещён, если он является единственным способом входа без установленного пароля/другой identity.

## 6. Сессии и cookies

- Cookies: `Secure`, `HttpOnly`, адекватный `SameSite`, узкий Domain/Path.
- Маркетинговый сайт не получает cookie приложения без необходимости.
- Admin использует отдельную cookie/session audience.
- Access session короткоживущая; refresh rotation.
- Session record содержит hash token, device metadata, IP history в допустимом объёме и expiry.
- CSRF token привязан к session.
- Logout инвалидирует server-side session.
- Concurrent session policy настраивается для enterprise.
- «Запомнить меня» влияет на срок refresh, а не отключает защиту.

## 7. Роли и привилегии

- Default deny.
- Проверка permissions выполняется backend.
- UI скрывает/disable недоступные действия, но не является защитным барьером.
- Custom role не может выдать permission, которого нет у создателя, кроме platform admin workflow.
- Последнего workspace owner нельзя удалить или понизить без передачи владения.
- Service accounts не входят через пользовательский UI.
- API token scopes и project restrictions отображаются перед созданием.
- Высокорисковые admin actions требуют reason и step-up auth.
- Impersonation не передаёт права выше разрешённого support scope.

## 8. Секреты и provider credentials

### 8.1. Хранение

- Секреты не хранятся в Git, Docker image, frontend bundle, Directus public collection и обычном JSON config.
- Deployment secrets задаются через Dokploy/environment secret storage либо внешний secret manager.
- BYOK credentials шифруются envelope encryption.
- Data encryption key шифруется master key; master key находится вне базы.
- Ciphertext, key version, nonce и auth tag хранятся отдельно от display metadata.
- UI после создания показывает только mask/label/last verified.
- API никогда не возвращает plaintext credential.

### 8.2. Использование

- Decryption доступен только integration worker с нужной capability.
- Plaintext существует в памяти минимально возможное время.
- Credential не помещается в queue payload; передаётся credential reference.
- Provider request logs проходят redaction.
- Ключи можно rotate, disable и удалить.
- Удаление проверяет активные jobs и предлагает безопасный переход.
- Компрометированный ключ отключается и создаёт уведомление.
- Platform credentials разделены по provider/environment и имеют минимальные provider permissions.

## 9. Шифрование и ключи

- TLS 1.2+; предпочтительно TLS 1.3.
- Внутренний traffic не публикуется наружу; sensitive межхостовой traffic шифруется.
- PostgreSQL, Redis, NATS и object storage требуют authentication.
- Storage volumes и offsite backups шифруются.
- Signed URL короткоживущие, scoped на object и operation.
- Encryption keys имеют version и rotation procedure.
- Потеря master key рассматривается в DR runbook.
- Secret rotation проверяется минимум дважды в год.

## 10. Сетевая безопасность

VPS делятся на роли:

- edge/application;
- data;
- workers;
- backup/monitoring при росте.

Требования:

- public exposed только reverse proxy и необходимые SSH/VPN management endpoints;
- PostgreSQL, Redis, NATS, object storage admin и metrics не открыты в интернет;
- firewall allowlist между хостами;
- SSH key-only, root login отключён после bootstrap;
- отдельные non-root deployment users;
- регулярные OS security updates;
- fail2ban или эквивалент для management plane;
- Dokploy admin защищён MFA/VPN/IP allowlist по возможности;
- staging и production разделены credentials, networks и data;
- Directus admin не индексируется и защищён rate limiting/MFA.

## 11. SSRF-защита

Применяется для technical crawler, webhook, URL metadata, import by URL и любых server-side fetch:

- разрешены только `http`/`https`, если функция не требует иного;
- URL разбирается стандартным parser;
- запрещены localhost, private, loopback, link-local, multicast, metadata и reserved ranges IPv4/IPv6;
- DNS resolve выполняется до запроса;
- IP проверяется после каждого redirect;
- redirect count ограничен;
- DNS rebinding mitigated повторной проверкой;
- outbound proxy/network policy желательно;
- порты ограничены;
- response size/time/content type ограничены;
- credentials/Authorization не пересылаются на новый origin;
- пользователь не видит raw internal error;
- webhook endpoints проходят ту же проверку.

Для crawler разрешён доступ только к публичным сайтам пользователя, не к внутренним сетям.

## 12. Импорт и экспорт

### 12.1. Импорт

- Allowlist форматов.
- MIME определяется по содержимому, а не только расширению.
- Архивы проверяются на traversal, число файлов, вложенность и коэффициент распаковки.
- Макросы и исполняемые вложения не исполняются.
- XLS/XLSX читаются библиотекой в изолированном worker.
- Ограничены строки, колонки, длина ячейки, формулы и shared strings.
- CSV parser защищён от memory exhaustion.
- Файлы сканируются malware scanner.
- Ошибочная строка не выводит секретное содержимое в telemetry.
- Временные файлы автоматически удаляются.

### 12.2. Экспорт

- Значения, начинающиеся с `=`, `+`, `-`, `@`, безопасно экранируются для spreadsheet formats.
- Export проверяет permission повторно при скачивании.
- Signed link истекает.
- Export manifest фиксирует filter/version/time.
- Password-protected archive может быть enterprise option, пароль передаётся отдельным каналом.
- Guest report не даёт доступ к исходному export без отдельного grant.

## 13. Web security

- Content Security Policy без `unsafe-eval`; inline scripts через nonce/hash.
- `frame-ancestors` по умолчанию запрещает embedding, кроме специально разрешённых guest reports.
- HSTS после проверки всех поддоменов.
- `X-Content-Type-Options: nosniff`.
- Referrer policy минимизирует утечки.
- Permissions Policy отключает ненужные browser capabilities.
- Все rich text/HTML санитизируются allowlist sanitizer.
- React escaping не обходится для provider/keyword content.
- Open redirects исключены allowlist/path validation.
- CORS разрешает только известные origins; credentials не сочетаются с `*`.
- GraphQL не вводится без отдельной необходимости и threat model.
- Source maps production доступны только error-monitoring backend.

## 14. API security

- DTO schema validation с запретом неизвестных чувствительных полей.
- Mass assignment исключён явным mapping.
- Parameterized queries через Prisma; raw SQL только reviewed и parameterized.
- Request body/header/query size limits.
- Slow/complex query guard.
- Rate limiting.
- Idempotency.
- Object-level authorization.
- Audit sensitive mutation.
- Egress timeout.
- Provider payload validation.
- Pagination hard limits.
- API tokens хэшируются, plaintext показывается один раз.
- Public API имеет отдельные scopes и usage anomaly detection.

## 15. Supply chain и container security

- Lockfiles обязательны.
- Renovate/Dependabot-equivalent создаёт контролируемые обновления.
- SCA проверяет известные уязвимости.
- Secret scanning и license policy в CI.
- Docker images строятся multi-stage.
- Runtime image минимален и запускается non-root.
- Versions pin по digest для critical base images.
- SBOM генерируется для release image.
- Image vulnerability scan блокирует критические известные уязвимости без принятого исключения.
- Release image immutable и продвигается между средами, а не пересобирается.
- Build provenance/signing рекомендуется.
- Production containers read-only filesystem там, где возможно.
- Linux capabilities удалены; privileged containers запрещены.
- Direct access к Docker socket запрещён приложению.

## 16. Privacy и международные требования

Продукт должен поддерживать:

- Privacy Policy и Terms по локалям;
- consent records с version документа;
- cookie consent для необязательной marketing analytics;
- DPA workflow для B2B;
- export данных субъекта;
- удаление/анонимизацию аккаунта;
- retention policies;
- список subprocessors;
- purpose/category metadata для PII;
- настройку marketing communications отдельно от service notifications;
- запись законного основания/consent там, где применимо;
- механизм legal hold;
- обработку requests на доступ/исправление/удаление;
- возможное региональное размещение как будущую capability, но не обещать его до реализации.

Техническое удаление не должно повреждать финансовые и security records, которые должны храниться по закону; такие данные минимизируются и псевдонимизируются.

## 17. Audit log

Audit event содержит:

- actor type/id;
- effective actor и original actor при support session;
- workspace/project;
- action;
- resource type/id;
- before/after diff с redaction;
- reason;
- IP/user agent;
- request/trace ID;
- timestamp;
- outcome.

Аудируются:

- authentication и MFA;
- изменение roles/members;
- credentials;
- billing;
- exports;
- share links;
- project deletion;
- admin actions;
- impersonation;
- data retention/legal hold;
- feature/limit overrides;
- security policy changes.

Audit log append-only на уровне приложения. Изменение/удаление пользователем запрещено.

## 18. Логирование

Структурированные JSON logs включают:

- timestamp;
- level;
- service/version/environment;
- message code;
- request/trace/correlation/job ID;
- tenant IDs при допустимости;
- duration;
- error class;
- provider alias без credential.

Запрещено логировать:

- passwords;
- session/access/refresh tokens;
- cookies;
- OAuth codes;
- API keys;
- raw payment data;
- полное содержимое файлов;
- лишние PII;
- signed URLs целиком.

Redaction тестируется автоматически. Debug logging в production временно включается через контролируемый механизм.

## 19. Observability

### 19.1. Metrics

- HTTP RED: rate, errors, duration;
- worker USE: utilization, saturation, errors;
- DB connections, locks, slow queries, replication/PITR health;
- Redis memory/evictions/latency;
- NATS lag/redelivery/DLQ;
- queue depth/wait/runtime/failure;
- provider latency/rate limits/balance/errors;
- WebSocket connections/reconnect/dropped events;
- import throughput/error rows;
- rank snapshots per time unit;
- object storage errors/capacity;
- billing reservations/settlements inconsistencies;
- notification delivery;
- business metrics без high-cardinality labels.

### 19.2. Tracing

OpenTelemetry применяется для:

- web request;
- internal calls;
- queue/job;
- provider call;
- database span с безопасным statement metadata;
- event publish/consume.

Trace sampling повышается для errors и дорогих операций. Secrets и raw keyword lists не попадают в spans.

### 19.3. Dashboards

Обязательные dashboards:

- platform overview;
- SLO;
- API per service;
- queue health;
- provider health/cost;
- PostgreSQL;
- Redis/NATS;
- realtime;
- billing integrity;
- imports/exports;
- infrastructure capacity;
- deployments.

## 20. SLO и SLI

Начальные цели после стабилизации P2:

- доступность интерактивного приложения/API: 99.9% в месяц;
- доступность guest reports: 99.9%;
- p95 чтения обычных API: до 500 мс без учёта тяжёлых search/export;
- p95 mutation, создающего job: до 800 мс;
- p95 real-time доставки внутри региона: до 500 мс;
- 99% запланированных jobs начинают исполнение в пределах согласованного queue-delay target с учётом provider limits;
- billing ledger consistency: 100%, расхождения автоматически алертятся;
- RPO основных баз: не более 15 минут;
- RTO первой production-версии: до 4 часов, целевой зрелый — до 1 часа.

Maintenance, внешние provider outages и force majeure учитываются в публичной политике отдельно, но собственная деградация всё равно измеряется.

## 21. Performance budgets

### 21.1. Web

- Core Web Vitals маркетингового сайта должны соответствовать актуальным good thresholds на p75.
- Initial route JavaScript ограничивается budget, фиксируемым после design prototype.
- Неиспользуемые тяжёлые editor/chart/table modules загружаются динамически.
- Таблица не рендерит миллионы DOM nodes; применяется virtualization.
- Interaction feedback появляется до 100 мс либо показывает pending state.
- Большие фильтры и агрегации выполняются сервером.

### 21.2. Backend

- N+1 queries запрещены.
- Все критичные queries имеют `EXPLAIN ANALYZE` baseline на representative data.
- Connection pool ограничен на service/instance.
- Batch size подбирается load test.
- Provider concurrency контролируется отдельно.
- Один workspace не занимает всю очередь.
- Raw SERP, imports и history не выдаются без pagination.

## 22. Accessibility

Цель — WCAG 2.2 AA для маркетингового сайта и основных рабочих сценариев приложения.

Обязательно:

- keyboard navigation;
- видимый focus;
- корректные labels/descriptions/errors;
- semantic headings/landmarks;
- достаточный contrast;
- не полагаться только на цвет;
- reduced motion;
- screen-reader announcements для async state;
- таблица имеет доступную альтернативу и управление;
- charts имеют textual summary/data table;
- drag-and-drop имеет keyboard alternative;
- modals управляют focus;
- cursor presence не мешает assistive technology;
- локализуемые aria-labels;
- automated axe-like checks и manual testing.

## 23. Совместимость

Поддерживаются текущая и предыдущая major версии:

- Chrome;
- Edge;
- Firefox;
- Safari.

Mobile Safari/Chrome поддерживают marketing site, guest reports и dashboard/read flows. Полноценная работа с многомиллионной семантической таблицей на телефоне не является обязательной; интерфейс показывает адаптированные действия.

## 24. Стратегия тестирования

### 24.1. Unit

Покрывают:

- business rules;
- normalization;
- cost/ledger calculations;
- permissions;
- provider error mapping;
- import mapping;
- filter DSL;
- scheduling/timezones.

Покрытие строк не является единственным KPI; критичные инварианты должны иметь явные tests.

### 24.2. Integration

Используют реальные ephemeral PostgreSQL/Redis/NATS/S3-compatible services:

- Prisma transactions;
- outbox/inbox;
- queues;
- partition queries;
- credential encryption;
- webhooks;
- object upload;
- Directus client boundaries.

### 24.3. Contract

- OpenAPI request/response validation;
- event schema;
- provider adapters против recorded/sandbox contracts;
- payment webhook fixtures;
- backward compatibility.

### 24.4. End-to-end

Критичные сценарии:

- регистрация каждым способом;
- создание workspace/project;
- invite и roles;
- импорт Key Collector export;
- mapping/custom columns;
- rank check BYOK и platform key;
- недостаточный баланс;
- automation schedule;
- realtime presence/conflict;
- report share;
- checkout/top-up;
- credential rotation;
- project deletion/restore;
- admin suspension.

### 24.5. Non-functional

- load;
- soak;
- spike;
- failover;
- chaos для provider/queue;
- security DAST;
- dependency/container scan;
- accessibility;
- visual regression;
- backup restore;
- migration rehearsal.

## 25. Тестовые данные и среды

Среды:

- local;
- preview per pull request для web при возможности;
- shared development;
- staging;
- production.

Правила:

- production secrets/data не копируются в development;
- staging dataset синтетический или необратимо анонимизированный;
- seed создаёт роли, проекты, семантику, history, jobs и billing cases;
- provider sandbox/mock управляется feature flag;
- clocks/timezones тестируются детерминированно;
- destructive tests выполняются в изолированной базе;
- migrations прогоняются на объёме, близком к production.

## 26. CI quality gates

Для каждого репозитория:

- formatting;
- lint;
- TypeScript strict check;
- unit/integration tests;
- contract validation;
- Prisma schema validation/migration check;
- build;
- dependency/security scan;
- container build/scan;
- forbidden secret check;
- affected E2E для критичных изменений.

Merge запрещён при failed required checks. Исключение уязвимости или flaky test имеет owner, срок и документированную причину.

## 27. Релиз

- Trunk-based либо короткоживущие branches.
- Semantic/versioned releases для contracts.
- Conventional changelog не обязателен, но user-facing изменения документируются.
- Feature flags отделяют deploy от release.
- DB migration выполняется expand → migrate/backfill → switch → contract.
- Перед release есть backup/rollback readiness.
- Canary/rolling rollout в пределах возможностей Dokploy.
- Worker drain перед shutdown.
- Старый consumer не получает несовместимое событие.
- После deploy выполняются smoke tests.
- Автоматический rollback допускается только если не усугубит уже применённую migration.

## 28. Feature flags

Flag содержит:

- key;
- description;
- owner;
- environments;
- audience rule;
- created/expiry date;
- kill switch;
- audit.

Флаги не заменяют permissions. Долгоживущие flags удаляются после завершения rollout. Изменение billing/entitlement flag требует дополнительного контроля.

## 29. Backup

### 29.1. PostgreSQL

- PITR/WAL;
- daily full/base backup;
- шифрование;
- offsite copy;
- retention tiers;
- checksum/verification;
- quarterly restore drill минимум, чаще на раннем этапе;
- Directus backup отдельно;
- схема и migration history входят в recovery.

### 29.2. Redis/NATS/object storage

- Redis queue persistence настраивается, но Redis не считается единственным источником domain truth.
- NATS JetStream хранит достаточно для replay по определённой политике.
- Object storage versioning для критичных buckets.
- Lifecycle не удаляет активный report/export/import раньше retention.
- Backup manifests сверяются с DB references.

## 30. Disaster recovery

Runbook описывает:

- потерю одного application VPS;
- потерю worker VPS;
- отказ data VPS;
- повреждение PostgreSQL;
- потерю Redis;
- потерю NATS;
- недоступность object storage;
- компрометацию credential;
- массовую ошибку списаний;
- неудачную migration;
- утрату региона/провайдера VPS.

Для каждого:

- detection;
- incident commander;
- containment;
- recovery steps;
- data reconciliation;
- user communication;
- RPO/RTO;
- evidence preservation;
- postmortem.

## 31. Incident management

Severity:

- SEV-1 — security breach, tenant leak, billing corruption, полный outage;
- SEV-2 — существенная деградация ключевого потока;
- SEV-3 — ограниченный impact/workaround;
- SEV-4 — minor.

Обязательно:

- on-call;
- alert routing;
- status page;
- incident channel/timeline;
- регулярные updates;
- postmortem без поиска виноватых;
- corrective actions с owner/date;
- security incident procedure и notification assessment.

## 32. Alerting

Alert должен быть actionable и содержать:

- impact;
- текущий показатель;
- dashboard;
- runbook;
- recent deployment;
- owner.

Page-worthy:

- SLO burn;
- tenant isolation/security signal;
- billing invariant break;
- DB unavailable/low disk/PITR failure;
- queue stuck;
- widespread provider failure при отсутствии fallback;
- NATS/Redis unavailable;
- backup failure;
- certificate expiration;
- object storage near capacity.

Неизменяющийся внешний provider status не должен создавать бесконечный alert storm.

## 33. Capacity management

Еженедельно/ежемесячно оцениваются:

- PostgreSQL storage, IOPS, connections, partition growth;
- raw SERP/object storage;
- Redis memory;
- queue throughput;
- worker CPU/RAM;
- NATS retention;
- WebSocket connections;
- backup duration/size;
- provider quotas/platform balances;
- cost per workspace/job.

Порог расширения определяется заранее. До достижения 70–80% устойчивой ёмкости создаётся capacity task.

## 34. Dokploy requirements

- Все production services описаны Compose/конфигурацией в infrastructure repo.
- Environment variables разделены по средам.
- Health checks различают liveness/readiness.
- Startup не объявляется ready до проверки обязательных dependencies, но не блокируется навсегда из-за необязательного provider.
- Persistent volumes явно документированы.
- Automated database migration не запускается конкурентно несколькими replicas.
- Worker process types разворачиваются отдельно и масштабируются независимо.
- Domains/TLS настраиваются через Dokploy reverse proxy.
- Internal databases не получают public domain.
- Deployment history и rollback image сохраняются.
- Dokploy и VPS config экспортируются/документируются так, чтобы восстановление не зависело от единственного UI.

## 35. Maintenance

Периодические задачи:

- partitions;
- vacuum/analyze monitoring;
- index bloat/reindex planning;
- expired uploads/exports cleanup;
- old session/token cleanup;
- outbox/inbox cleanup после retention;
- Yjs compaction;
- orphan object reconciliation;
- webhook delivery cleanup;
- provider credential revalidation;
- price book sync/review;
- backup verification;
- certificate/domain checks;
- dependency/OS upgrades.

Каждая maintenance job идемпотентна, observable и ограничена по batch/time.

## 36. Data lifecycle

Для каждого класса данных фиксируются:

- owner;
- purpose;
- source;
- sensitivity;
- storage;
- encryption;
- retention;
- archive;
- deletion/anonymization;
- backup behavior;
- export eligibility.

Удаление project:

1. immediate archive/disable jobs;
2. grace period восстановления;
3. irreversible deletion job;
4. objects/search/cache cleanup;
5. tombstone/event;
6. backup expiry по retention;
7. audit completion.

## 37. Operational admin

Администратор видит:

- health сервисов;
- queue lag;
- failed jobs/DLQ;
- provider availability/limits;
- platform provider balance;
- webhook failures;
- billing reconciliation;
- storage/capacity;
- deployment version;
- active incidents;
- feature flags;
- backup status.

Админ может безопасно:

- pause provider/capability;
- pause queue/automation class;
- retry/replay с idempotency;
- quarantine upload;
- revoke credential/session/token;
- suspend account/workspace;
- grant documented temporary limit;
- выполнить compensation ledger entry;
- включить maintenance banner.

Прямое редактирование production DB из UI запрещено.

## 38. Definition of Done

Функция считается готовой, если:

- выполнены product и UX acceptance criteria;
- permissions проверены;
- loading/empty/error/offline/partial states реализованы;
- данные локализуемы и timezone-aware;
- есть unit/integration/E2E tests по риску;
- telemetry и audit добавлены;
- accessibility проверена;
- migrations reversible либо имеют recovery plan;
- документация/API contracts обновлены;
- threat model пересмотрен для чувствительной функции;
- performance проверена на representative volume;
- нет critical/high уязвимостей без принятого решения;
- есть runbook для новой operational failure mode.

## 39. Критерии приёмки раздела

- Автоматический cross-tenant test suite проходит для всех tenant resources.
- Provider credentials не появляются в API responses, logs, traces, events и queue payload.
- Restore drill подтверждает заявленный RPO/RTO.
- Повтор платёжного события не изменяет ledger второй раз.
- Импорт защищён от zip bomb, formula injection и вредоносного файла.
- SSRF tests блокируют private, loopback, metadata и DNS rebinding cases.
- CI останавливает несовместимый contract и критическую уязвимость.
- Основные сценарии проходят keyboard и screen-reader smoke testing.
- Alert на критичный отказ содержит рабочий runbook.
- Production deployment можно воспроизвести из versioned infrastructure configuration.
