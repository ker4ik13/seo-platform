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
- Security-значимые session writers одного пользователя сериализуются общим
  namespaced PostgreSQL advisory transaction lock. Выдача session под lock
  повторно требует ожидаемую версию `ACTIVE` пользователя.
- Terminal revoke всегда применяется ко всей refresh family и атомарно пишет
  redacted `identity.session-family.revoked.v1`; outbox failure откатывает
  revoke. Rotation внутри family и access-token TTL это событие не создают.
- Новая refresh family получает UUIDv7; legacy UUIDv4 остаётся валидным
  идентификатором существующей family без миграции.
- Password reset под тем же lock инвалидирует outstanding login MFA
  challenges до выдачи новой family. MFA disable и revoke others исключают
  всю family текущей principal.
- MFA setup/activation/disable и session revoke-others повторно валидируют под
  lock active/unexpired principal session по точным
  `sessionId + userId + sessionFamilyId`; activation/disable также требуют
  ожидаемую user version.
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
- Payload AAD содержит workspace, provider и immutable credential ID; AAD
  обёрнутого data key дополнительно содержит master key version.
- Ciphertext, key version, nonce и auth tag хранятся отдельно от display metadata.
- UI после создания показывает только mask/label/last verified.
- API никогда не возвращает plaintext credential.

### 8.2. Использование

- Provider request выполняет отдельный connector worker с credential role
  `EXECUTION`. Он получает KEK, но не получает credential management API
  token, fingerprint keyring, HTTP listener или полномочия create/rotate.
  Generic system/import/inspection workers и migration process не получают
  credential keyring. Runtime config guard работает fail-closed: `DISABLED`
  отклоняет credential secrets, а `EXECUTION` — management/fingerprint/
  internal/NATS и S3/SMTP secrets. Это защита от misconfiguration, а не
  криптографическая граница.
- Management API принимает только полную замену secret payload и не
  вызывает провайдера. HTTP-процесс получает симметричный KEK для envelope
  encryption. Role guard запрещает штатный decrypt, но общий symmetric key не
  является криптографической изоляцией при компрометации процесса; до
  production эта граница выносится в KMS/asymmetric wrapping,
  credential broker/HSM либо принимается отдельным ADR с threat model.
- Plaintext существует в памяти минимально возможное время.
- Credential не помещается в queue payload; передаётся credential reference.
- Provider request logs проходят redaction.
- Ключи можно rotate, disable и удалить.
- Удаление проверяет активные jobs и предлагает безопасный переход.
- Компрометированный ключ отключается и создаёт уведомление.
- Platform credentials разделены по provider/environment и имеют минимальные provider permissions.
- Management API и connector worker используют разные PostgreSQL logins.
  Текущий execution login ограничен по DML, но имеет `SELECT` всех строк и
  колонок `jobs` и `integration_credentials` внутри `jobs_db`; это не
  tenant/secret isolation. Компрометация connector process раскрывает job
  snapshots/metadata всех tenants и, поскольку process получает KEK, весь
  BYOK vault этой database. До production это release blocker: нужна узкая
  execution projection/table с server-side scope либо credential broker/KMS,
  исключающий global vault read. Дополнительно обязательны fresh non-owner
  role provisioning, cluster-wide grant audit и `pg_hba`/отдельный cluster
  boundary; ownership объектов кластера script отклоняет fail-closed. Общий
  Redis password текущего среза заменяется отдельным ACL/instance; DB
  owner/superuser credential connector worker-у запрещён как production
  invariant.
- Перед включением внешних уведомлений terminal validation должен атомарно
  писать только нормализованный error code и redacted outbox/audit event, но
  не raw provider response; в первом validation slice terminal outbox ещё
  отсутствует.
- Для manual rank execution применяется ADR-2026-034. До live submit
  connector получает только scoped execution claim через allowlisted
  SECURITY DEFINER operations: authorize action, record submit, schedule
  poll, stage normalized rows и finish/fail. Прямой global read jobs/vault
  execution-role запрещён. Claim повторно проверяет tenant/job/item, lease,
  одноразовый lifecycle grant, binding/material/connector versions и kill
  switch. Default-closed `claim_rank_connector_execution` уже реализован:
  `PUBLIC EXECUTE` отозван, connector-role grant/runtime caller отсутствуют,
  а `CLAIMED` не разрешает network. Перед bytes нужна отдельная authorize/
  `SUBMITTING` operation; остальные scoped operations ещё не реализованы.
- Platform API issuer защищён отдельным
  `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`, который не переиспользуется как
  internal/credential/realtime/SEO rank token. Текущий Compose передаёт его
  только Platform API и rank-worker с bounded grant client. Token отсутствует
  у generic Jobs HTTP, connector/import/inspection/system/migration, Web и
  остальных сервисов. Internal endpoint требует exact single-value
  request/tenant/actor/idempotency headers, `no-store` и path/header/body
  coherence.
- Issuer сериализует owned authorization rows в порядке
  workspace → project → user → membership → project access и сохраняет
  immutable decision в той же transaction, где policy создаёт authoritative
  quota reservation. Production policy не имеет runtime/env bypass и не
  выдаёт `GRANTED` без reservation ID. Expired exact replay не переписывается;
  Jobs client проверяет TTL/hash/scope, сохраняет exact decision и атомарно
  создаёт secret-free scoped execution вместе с `CONSUMED`. Эта row сама не
  выдаёт credential material. Подготовленная SECURITY DEFINER claim-функция
  возвращает exact encrypted projection только после повторной проверки
  current graph, но пока недоступна connector role и не подключена к runtime.
- До HTTP Jobs записывает immutable exact `REQUESTED` intent и stable
  idempotency key в `rank_execution_grant_attempts`. Retryable ambiguity
  повторяет сохранённый request; response под canonical graph locks и DB
  clock становится `DENIED`, `EXPIRED`, `GRANTED_PENDING_CONSUME` либо
  `REJECTED_LOCAL`. `GRANTED_PENDING_CONSUME` не является execution claim;
  только повторно проверенная one-to-one
  `CONSUMED ↔ rank_connector_executions/READY_TO_SUBMIT` пара фиксируется
  атомарно. Dispatcher/provider path к service не подключён.
- Plaintext keyword manifest boundary использует отдельный
  `JOBS_TO_SEO_RANK_TOKEN` и `x-rank-execution-token`. Он обязан отличаться
  от `INTERNAL_API_TOKEN` и credential/realtime tokens. Generic internal
  callers, connector/import/system workers, Web, queue payload и логи его не
  получают. В реализованном PREPARING runtime secret получают только SEO
  Data validator и выделенный `rank-worker.main.ts`; Jobs HTTP и остальные
  process types его не получают. Клиент запрещает HTTP redirects, ограничивает
  body и строго валидирует tenant-bound seal/finalization receipts.
  Ротация выполняется совместимым expand → switch caller → retire old
  protocol, без публикации обоих значений в application data.
- Любой provider response, для которого нет recorded schema, считается
  `INVALID_RESPONSE`, не преобразуется эвристически в rank snapshots и не
  попадает в публичные ошибки, логи или events.

## 9. Шифрование и ключи

- TLS 1.2+; предпочтительно TLS 1.3.
- Внутренний traffic не публикуется наружу; sensitive межхостовой traffic шифруется.
- PostgreSQL, Redis, NATS и object storage требуют authentication.
- Storage volumes и offsite backups шифруются.
- Signed URL короткоживущие, scoped на object и operation.
- Encryption keys имеют version и rotation procedure.
- BYOK KEK и keyed idempotency fingerprint используют разные versioned
  keyrings и независимые rotation/retention lifecycle; повторное использование
  одного key material запрещено.
- Отображение `keyVersion → key bytes` immutable. Новое key material получает
  новую version; изменять значение уже выпущенной версии запрещено.
- Credential-capable процесс до открытия HTTP агрегированно сверяет
  используемые KEK/fingerprint versions с keyrings и при пробеле завершается
  fail-closed.
- Browser Web Push subscription material использует отдельные от BYOK и auth
  versioned keyrings: AES-256-GCM для endpoint/keys и HMAC-SHA-256 для exact
  fingerprints. Key material между ними не переиспользуется; Realtime до
  открытия HTTP агрегированно проверяет coverage active rows. Coverage
  подтверждает только наличие version, а не неизменность bytes. До включения
  production-регистрации обязателен persistent authenticated canary/manifest
  каждой AES/HMAC version; same-version replacement запрещён. HMAC rotation
  требует одинакового overlap keyring на всех replicas до drain старых
  процессов и switch active version.
- Управление push devices принимает только отдельный
  `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`; общий internal credential не
  даёт доступ к этой границе. Endpoint принимается только по exact HTTPS
  origin allowlist без IP literals, credentials, fragment и custom ports.
- VAPID private key запрещён в Platform API, Realtime management HTTP, Web,
  browser bundle, Compose текущего среза, logs и обычных application config
  dumps. Его получает только будущий sender role; резервная копия допустима
  только внутри защищённого versioned secret store.
- Revoke/expiry browser device обязан в одной транзакции очистить ciphertext,
  nonce/tag и fingerprints. Producer durable session-family revoked event уже
  реализован по ADR-2026-036; Realtime application handler с durable
  tombstone и fail-closed upsert также готов. Outbox publisher и JetStream
  subscription обязательны до включения внешней доставки.
- KEK rollout выполняется в порядке expand keyring → startup decrypt-canary
  verify каждой используемой версии → drain старых replicas → switch active.
  `EXECUTION` replica до создания queue worker проверяет coverage, затем для
  каждой используемой версии расшифровывает один детерминированный
  неудалённый sample через штатный adapter с точным AAD; пустой vault допустим,
  а missing/corrupt sample останавливает startup. Ошибка содержит только
  `keyVersion`, но не tenant, credential, provider или secret. `MANAGEMENT`
  проверяет encryption/fingerprint coverage без decrypt. Validation worker
  выполняет job-only bounded retry без изменения credential при runtime
  decrypt failure, поэтому не создаёт массовый `DISABLED`. Cluster-wide
  circuit breaker и incident alert для отказов после startup ещё не
  реализованы; startup canary не заменяет scoped connector DB boundary.
- Vault endpoints не принимают общий межсервисный token: отдельный caller
  secret доступен только Platform API и credential-capable HTTP process, до
  плановой замены на service JWT/mTLS.
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

Credential validation строже общего server-side fetch: URL, origin, method и
auth header фиксированы versioned connector allowlist, redirect запрещён,
успешный `2xx` обязан быть JSON, а non-2xx сохраняет безопасную
status-классификацию даже при пустом/non-JSON body. Ответ ограничен по времени
и фактически прочитанному размеру. Пользовательский base URL не принимается.
Execution worker получает отдельный исходящий Docker route без опубликованных
портов; до high-assurance production этот route дополнительно ограничивается
host firewall или egress proxy по provider DNS/hostname allowlist.

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
- `/app/**` возвращает `X-Robots-Tag: noindex, nofollow, noarchive`, private
  metadata и `Cache-Control: private, no-store`;
- `/app` исключён из sitemap/public search и закрыт `robots.txt`, но security
  не полагается на robots directive;
- публичные Toolbox results, preview и tokenized URLs имеют noindex и не
  создают user-generated SEO pages;
- server-only Directus/application clients не попадают в browser bundle;
- единый основной домен не означает общий cache: public и `/app` имеют
  разные cache keys/policies и automated tenant leak tests.

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

Mobile Safari/Chrome поддерживают public web, Toolbox, guest reports и
dashboard/read flows. Полноценная работа с многомиллионной семантической
таблицей на телефоне не является обязательной; интерфейс показывает
адаптированные действия.

Target server runtime — Node.js 24. Engine check должен выполняться в CI и
production image; локальные typecheck/test/build на Node.js 22 с engine
warning являются дополнительным evidence, но не заменяют Node.js 24 release
gate.

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
- immutable rank manifest lifecycle, provenance и active semantic dedup;
- manual rank `Job + RankJobRun` graph, immutable exact command/hash,
  state/receipt triggers и dispatcher recovery;
- конкурентные `claim ↔ cancel ↔ persist/finalize` сценарии с единым lock
  order `Job → RankJobRun`, bounded serialization retry и единственным
  допустимым cancel version drift;
- bounded 20-attempt preparation и terminal
  `ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` без ложного `NOT_SEALED`;
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
- migration rehearsal;
- Для rank manifest migration отдельно проверяются: fresh apply;
  невозможность committed `BUILDING`; прямого `SEALED/CLOSED`; late
  child/update/delete/truncate; provenance mismatch; concurrent active-dedup
  winner; `SEALED → CLOSED`, immutable finalization receipt и повторный seal
  после освобождения active key;
- Для manual rank preparation migrations отдельно проверяются: fresh apply;
  обязательный one-to-one `Job ↔ RankJobRun`; запрет incomplete graph;
  immutable evidence/terminal outcome; разрешённые Job/seal transitions;
  `PREPARING` dispatcher recovery; cancel до и после seal; исчерпание attempts
  в `ACTION_REQUIRED`, а не бесконечный retry; half-null snapshot/receipt;
  monotonic Job version/attempt; Job/Run/Estimate coherence; запрет подмены
  command binding; Redis partition после DB commit.

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
- Node.js 24 engine/typecheck/test/build;
- PostgreSQL 18 fresh migration и negative invariant smoke для новых
  trigger/partial-index state machines;
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
- `20260729160000_rank_execution_manifests` до production обязательно
  репетируется на PostgreSQL 18. Успешный локальный PostgreSQL 15 smoke
  является дополнительным evidence, но не заменяет target-version gate.
- `20260729170000_rank_job_preparing_status` и
  `20260729170100_rank_job_preparation` также требуют fresh apply,
  constraint-negative и реальных concurrent cancel/worker smoke на
  PostgreSQL 18. Успешный локальный PostgreSQL 15 deploy не заменяет этот
  gate. Migration fail-closed проверяет legacy manual rows и active dedup
  conflicts; обычный unique-index rebuild выполняется после worker drain в
  maintenance window. Для большой live-БД заранее готовится отдельный
  expand/concurrent-index план.
- `20260729230100_rank_execution_grant_attempts`,
  `20260729230200_rank_connector_executions` и
  `20260730101500_rank_connector_execution_claim` требуют fresh apply,
  tenant-FK/state-matrix/deferred one-to-one negative smoke и реальные
  concurrent request/replay/decision/expiry/consume проверки на PostgreSQL
  18. Fresh полный chain и claim-specific concurrent claim/reclaim,
  stale-head, cancel, credential и kill-switch regression уже прошли на
  PostgreSQL 18. Grant request/replay/decision/consume evidence и production
  non-owner permission/runtime boundary проверяются отдельно.
- Jobs/integrations и SEO Data release проверяется на Node.js 24; локальный
  Node.js 22 engine warning не принимается как production runtime evidence.
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

Radar/crawler capacity:

- отдельные worker concurrency и autoscaling limits;
- per-host token bucket поверх per-tenant fair queue;
- reserved capacity для billing/security/interactive jobs;
- JS rendering в отдельном browser pool;
- emergency global pause без остановки API и чтения результатов;
- alert по queue lag, host backoff, CPU, memory, open sockets и egress;
- public Toolbox не использует paid/crawl reserved concurrency.

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

### 34.1. Upload inspection contour

- ClamAV и inspection worker запускаются отдельным Compose profile/process
  type и доступны только во внутренней Docker network;
- `clamd` не публикует TCP 3310 наружу, использует persistent volume
  сигнатур и healthcheck с увеличенным cold-start;
- API не зависит от ClamAV по readiness и остаётся доступным для чтения;
  недоступность scanner останавливает только переход новых файлов в `ready`;
- лимиты `StreamMaxLength`, upload size и worker timeout согласованы;
- concurrency, queue lag, scan latency, retry rate и signatures age имеют
  отдельные метрики/alerts;
- rejected objects никогда не получают signed download URL и удаляются
  lifecycle/reconciliation job по утверждённому quarantine retention;
- увеличение upload limit требует capacity review S3 egress, ClamAV memory,
  scan time и очереди, а не только изменения frontend-константы.

### 34.2. Manual rank preparation contour

- `rank-worker.main.ts` разворачивается отдельным process type и получает
  только необходимые PostgreSQL/Redis/SEO Data/Platform API настройки,
  `JOBS_TO_SEO_RANK_TOKEN` для manifest boundary и отдельный
  `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` для issuer;
- manifest token отсутствует у Jobs HTTP, generic system, connector, import,
  inspection, migration, Web и Platform API processes; grant token получают
  только Platform API и rank-worker и не получают остальные process types;
- BullMQ `rank-preparation` передаёт только `jobId`; exact manifest command,
  hash, attempts, lease и receipts остаются в PostgreSQL;
- dispatcher периодически восстанавливает due `PREPARING/CANCEL_REQUESTED`
  jobs после потерянного Redis notification или worker crash;
- недоступность rank worker не влияет на чтение API; backlog/lease age,
  attempt exhaustion, `OUTCOME_UNKNOWN` и `ACTION_REQUIRED` должны получить
  отдельные metrics/alerts до production; текущий runtime имеет только
  структурированные логи;
- текущая изоляция обеспечена отдельным module/entrypoint и env allowlist.
  Перед live provider execution нужна отдельная минимальная DB role с
  проверенными grants; общий Jobs DB user не считается окончательной
  least-privilege boundary;
- grant service сохраняет intent/decision и атомарную secret-free
  `CONSUMED/READY_TO_SUBMIT` пару, но не вызывается dispatcher-ом. Production
  runtime отклоняет включённый submit, а Compose фиксирует
  `RANK_PROVIDER_SUBMIT_ENABLED=false`;
- default-closed SECURITY DEFINER claim DDL реализован, но `PUBLIC EXECUTE`
  отозван и connector role/runtime caller не подключены. Live Arsenkin submit
  остаётся выключенным, пока не реализованы authorize/`SUBMITTING`, остальные
  scoped operations, узкая end-to-end vault boundary, normalized ingest и
  provider contract gates.

## 35. Maintenance

Периодические задачи:

- partitions;
- vacuum/analyze monitoring;
- index bloat/reindex planning;
- expired uploads/exports cleanup;
- old session/token cleanup;
- bounded global refresh-session expiry sweeper, который использует тот же
  family revoke/outbox helper; один lazy refresh path недостаточен;
- outbox/inbox cleanup после retention;
- Yjs compaction;
- orphan object reconciliation;
- незавершённые `semantic_import_receipts` без chunks очищаются только после
  сверки с terminal import в `jobs_db`; receipt с применённым chunk не
  удаляется автоматически и требует safe finalize/reconciliation;
- validation/raw import staging очищается отдельными bounded batches после
  diagnostic retention, но semantic version и агрегированный result остаются;
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

Billing read-only не является стадией удаления. Окончание подписки, нулевой
баланс и downgrade никогда не запускают шаги project deletion. Они блокируют
только новые расходы/изменения и сохраняют чтение.

Для платежей ЮKassa в режиме НПД:

- запрещено хранить credentials/session «Мой налог»;
- ручная регистрация требует platform-admin MFA и audit;
- официальный receipt URL/ID сверяется с payment amount и buyer snapshot;
- receipt delivery contact защищается как PII;
- webhook payload ЮKassa проходит authentication, idempotency и reconciliation;
- чек не отменяется до подтверждённого refund;
- automated adapter разрешён только при официальном доступе ФНС/оператора.

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
Будущая команда suspend/deactivate/delete account обязана в своей транзакции
взять identity session lifecycle lock, отозвать все active families и создать
`identity.session-family.revoked.v1` на каждую изменённую family. Наличие lazy
проверки при refresh не заменяет producer команды.

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
- KEK rollout canary проверяет точное key material каждой используемой версии;
  системный decrypt mismatch не изменяет статусы credentials.
- Connector execution boundary не имеет global read всего multi-tenant BYOK
  vault и job snapshot набора.
- Manual rank create/get/cancel сохраняют tenant scope, exact replay и
  terminal outcome при конкурентном worker/cancel; non-retryable либо
  исчерпавшая budget ambiguity завершается `ACTION_REQUIRED`, а
  неидемпотентный provider submit автоматически не повторяется.
- Rank execution token доступен только выделенному rank worker и SEO Data,
  не следует redirect и не появляется в логах/queue payload.
- Restore drill подтверждает заявленный RPO/RTO.
- Повтор платёжного события не изменяет ledger второй раз.
- Импорт защищён от zip bomb, formula injection и вредоносного файла.
- SSRF tests блокируют private, loopback, metadata и DNS rebinding cases.
- CI останавливает несовместимый contract и критическую уязвимость.
- Основные сценарии проходят keyboard и screen-reader smoke testing.
- Alert на критичный отказ содержит рабочий runbook.
- Production deployment можно воспроизвести из versioned infrastructure configuration.
