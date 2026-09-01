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
- stored/reflected XSS через ключевые слова, страницы и rich text;
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

### 2.1. Безопасное обнаружение project favicon

Server-side favicon discovery принимает только нормализованный публичный
hostname проекта и canonical HTTP/HTTPS ports, запрещает credentials и
IP-literals. Каждый DNS result и фактический remote address проверяются на
private, loopback, link-local, multicast и reserved ranges; запрос выполняется
с DNS pinning, bounded timeout/body/redirect count и повторной проверкой remote
address против DNS rebinding. Redirect снова проходит тот же validator.
Полученный файл допускается в Core storage только после content-based image
validation; SVG с script, event handlers, external references или active
embedded content отклоняется.

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
- Cross-tenant joins запрещены, кроме специально спроектированной platform-admin аналитики с отдельным permission/audit boundary.

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
- Интерактивная recent reauthentication требуется для MFA, platform-admin,
  billing, удаления workspace и других явно перечисленных high-risk boundary.
  Provider credentials и soft delete проекта используют автоматически
  обновляемую active session, CSRF, permissions, audit и typed/CAS guards без
  повторного экрана логина.
- Все активные сессии видны пользователю, выводятся компактно по 10 и могут
  быть отозваны.
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
- Personal API token secret имеет high-entropy формат `seo_pat_*`, показывается
  только после create/rotate и хранится в Platform DB только как HMAC-SHA-256
  hash с server-side pepper. Display prefix, expiry, last-used, revoke state,
  ordered scopes и tenant-bound project allowlist не содержат token material.
  One-time modal нельзя закрыть Escape, backdrop, крестиком или финальной
  кнопкой, пока UI не подтвердил clipboard copy либо пользователь не выполнил
  `copy` из отображённого секрета.
  Rotation сохраняет предыдущий hash максимум на 10 минут; revoke перекрывает
  обе версии сразу.
- API token не является отдельным RBAC principal: каждый запрос повторно
  пересекается с актуальным status/membership/role/project access создавшего
  пользователя. Bearer разрешён только на явной tenant guard boundary или на
  token-only identifier discovery boundary, которая выводит только
  пересечение текущего доступа и allowlist; session-only routes и API-token
  management закрыты fail-closed.
- Высокорисковые admin actions требуют reason и step-up auth.
- Impersonation не передаёт права выше разрешённого support scope.

## 8. Секреты и provider credentials

### 8.1. Хранение

- Секреты не хранятся в Git, Docker image, frontend bundle, public content source и обычном JSON config.
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
  Execution login не имеет прямого DML к `jobs`, `integration_credentials`
  или canary table. Deploy-time script сначала отзывает connector и `PUBLIC`
  privileges на database/schema/tables/sequences/functions и выдаёт exact `EXECUTE`
  allowlist `SECURITY DEFINER` broker. Claim связывает одну validation Job с
  owner/random token/version/live lease и возвращает secret projection только
  после server-side tenant/material/state recheck; finish повторно проверяет
  fence и атомарно применяет Job/credential result. Provisioning wrapper
  удаляет password из child environment, принудительно создаёт SCRAM verifier
  через stdin `psql \\password` и отклоняет role на любой стороне membership
  edge. Grant DDL транзакционно сверяет cluster-wide direct ACL через
  `pg_shdepend/pg_database`: любые grants в другой database/shared object и
  вне exact current-DB allowlist блокируют provisioning, но ACL соседних
  сервисов не изменяются. Current-catalog audit также блокирует любое
  effective `PUBLIC CREATE/USAGE` в non-system schemas `jobs_db`, включая
  доступ через object kinds вне основного table/routine набора.
  Provisioning выполняется только от владельца Prisma migrations и всех
  routines в `public`; global и `IN SCHEMA public` default ACL закрыты, а
  существующие functions/procedures отзываются через `ALL ROUTINES` до exact
  grants. Generated HBA до общих rules разрешает connector local/host только
  в `jobs_db` по SCRAM и отклоняет replication/остальные databases, поэтому
  соседний `PUBLIC CONNECT` не обходит границу сменой DSN.
  PostgreSQL 18 regression проверяет non-public/cross-DB direct ACL,
  inherited PUBLIC, procedure/default/future-object bypass, management
  functions, concurrent reclaim, stale finisher, material drift и `pg_temp`
  shadowing; отдельный fixed-role HBA harness проверяет реальный cross-DB
  reject. Global vault read внутри `jobs_db` закрыт. В целевом окружении всё
  равно обязательны fresh provisioning, проверка фактического HBA order и
  login smoke; для межхостового PostgreSQL требуются TLS/source-CIDR либо
  отдельный cluster. Redis connector boundary использует отдельный named user
  с exact queue keyspace в dedicated Jobs instance/network;
  DB owner/superuser runtime запрещён.
- Перед включением внешних уведомлений terminal validation должен атомарно
  писать только нормализованный error code и redacted outbox/audit event, но
  не raw provider response; в первом validation slice terminal outbox ещё
  отсутствует.
- Для manual rank execution применяется ADR-2026-034. До live submit
  connector получает только scoped execution claim через allowlisted
  SECURITY DEFINER operations. Прямой global read jobs/vault execution-role
  запрещён. Claim повторно проверяет tenant/job/item, lease, одноразовый
  lifecycle grant, binding/material/connector versions и kill switch.
  Default-closed pre-authorization claim и bounded submit claim уже
  реализованы, а `PUBLIC EXECUTE` отозван. Connector permission allowlist
  выдаёт exact `EXECUTE` только на перечисленные broker functions. `CLAIMED` не разрешает
  network. Authorize повторно проверяет полный current graph, lease fence и
  ожидаемые execution/control versions, атомарно устанавливает `SUBMITTING`
  и durable may-have-started marker. До grant отдельная append-only private
  intent row повторно сверяется с authoritative sealed chunk и связывается с
  execution по request/manifest/chunk hashes; credential material в неё не
  входит. Таблица исключена из прав general `jobs_runtime`; только выделенный
  `jobs_rank_runtime` имеет exact `SELECT, INSERT`, без DDL, sequences,
  default privileges и чужих Jobs data domains. RLS ограничивает manual
  rank/validation/`SERP_RANK_TRACKING` graph, credential projection исключает
  ciphertext/DEK/nonces/tags, а DB guards запрещают фактические writes через
  lock-only column privileges. Runtime caller, recorded provider wire
  request/status/result и остальные scoped operations записываются только
  через lease-fenced brokers; raw provider payload не сохраняется.
  Retryable submit создаёт новый grant и monotonic execution attempt; исходная
  execution не возвращается в `READY_TO_SUBMIT`.
- Platform API issuer защищён отдельным
  `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`, который не переиспользуется как
  internal/credential/realtime/SEO rank token. Текущий Compose передаёт его
  только Platform API и rank-worker с bounded grant client. Token отсутствует
  у generic Jobs HTTP, connector/import/inspection/system/migration, Web и
  остальных сервисов. Internal endpoint требует exact single-value
  request/tenant/actor/idempotency headers, `no-store` и path/header/body
  coherence.
- Billing settlement защищён отдельным
  `JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN`, который получают только Core
  API и connector child. Exact `HOLD` подтверждает/ограниченно продлевает
  живой резерв без ledger mutation; exact `CAPTURE` допустим только после
  provider outcome. Connector читает из Jobs DB лишь grant ID и credential
  mode через отдельную `SECURITY DEFINER` функцию без billing amount или
  credential material.
- Issuer сериализует owned authorization rows в порядке
  workspace → project → user → membership → project access и сохраняет
  immutable decision в той же transaction, где policy создаёт authoritative
  usage/grant reservation. Production BYOK policy не имеет runtime/env bypass,
  не выдаёт `GRANTED` без reservation ID и не использует эти audit rows как
  дневную квоту. Expired exact replay не переписывается;
  Jobs client проверяет TTL/hash/scope, сохраняет exact decision и атомарно
  создаёт secret-free scoped execution вместе с `CONSUMED`. Эта row сама не
  выдаёт credential material. SECURITY DEFINER claim возвращает exact
  encrypted projection только после повторной проверки current graph и
  доступен connector role через exact permission grant; authorize имеет такой
  же narrow grant. Isolated connector-worker вызывает только эти brokers,
  сохраняет secret-free wire evidence и не имеет table DML.
- До HTTP Jobs записывает immutable exact `REQUESTED` intent и stable
  idempotency key в `rank_execution_grant_attempts`. Retryable ambiguity
  повторяет сохранённый request; response под canonical graph locks и DB
  clock становится `DENIED`, `EXPIRED`, `GRANTED_PENDING_CONSUME` либо
  `REJECTED_LOCAL`. `GRANTED_PENDING_CONSUME` не является execution claim;
  только повторно проверенная one-to-one
  `CONSUMED ↔ rank_connector_executions/READY_TO_SUBMIT` пара фиксируется
  атомарно. Dispatcher вызывает service по одному sealed manifest chunk.
- Plaintext keyword manifest boundary использует отдельный
  `JOBS_TO_SEO_RANK_TOKEN` и `x-rank-execution-token`. Он обязан отличаться
  от всех general caller/audience, credential/realtime и result tokens.
  Generic callers, connector/import/system workers, Web, queue payload и логи
  его не получают. В реализованном PREPARING runtime secret получают только
  SEO Data validator и выделенный `rank-worker.main.ts`; Jobs HTTP и остальные
  process types его не получают. Клиент запрещает HTTP redirects, ограничивает
  body и строго валидирует tenant-bound seal/finalization receipts.
  Ротация выполняется совместимым expand → switch caller → retire old
  protocol, без публикации обоих значений в application data.
- Любой provider response, для которого нет recorded schema, считается
  `INVALID_RESPONSE`, не преобразуется эвристически в rank snapshots и не
  попадает в публичные ошибки, логи или events.

### 8.3. PostgreSQL service credentials

- `POSTGRES_USER` используется только как cluster bootstrap administrator и
  не передаётся migrations/application runtimes. Каждая из `platform_db`,
  `seo_db`, `jobs_db`, `realtime_db` имеет отдельные canonical migration owner
  и runtime LOGIN-role с независимыми SCRAM secrets.
- Service roles обязаны быть `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS`, без membership edges и cross-database ownership/
  ACL. Runtime не владеет объектами и не получает `CREATE`, `TRUNCATE`,
  extension/role management или доступ к `_prisma_migrations`.
- Deploy order фиксирован: audited role/database bootstrap → owner-only Prisma
  migration → extension ACL hardening → owner-run runtime grants → connector
  grants → application startup. Пароли не помещаются в SQL literals, argv или
  logs; SCRAM verifier устанавливается через stdin.
- `PUBLIC CONNECT`, schema/object/routine privileges и global/schema default
  ACL отзываются в каждой принадлежащей сервису database. Runtime получает
  обычный CRUD/sequence access и только перечисленные callable routines;
  новая routine остаётся private до review allowlist.
- Generated first-match HBA разрешает canonical owner/runtime только в её
  точную database по SCRAM и до общих rules отклоняет replication, соседние
  databases и stale family names. Managed или межхостовой PostgreSQL обязан
  воспроизвести порядок и дополнить его TLS/source-CIDR либо отдельным cluster.
- Непустая legacy database со старым owner не передаётся автоматически:
  обязателен backup/restore rehearsal, catalog inventory, reviewed явный
  object ownership handoff и maintenance login smoke. Удалять данные или
  применять широкий `REASSIGN OWNED` общего bootstrap user без review
  запрещено.
### 8.4. Межсервисные symmetric credentials

Legacy `INTERNAL_API_TOKEN` удалён из deployment configuration и обязан
fail-closed останавливать startup при наличии. До перехода на service
JWT/mTLS действуют независимые caller/audience credentials:

| Credential | Разрешённые process types |
|---|---|
| `PLATFORM_API_TO_SEO_DATA_TOKEN` | Platform API и SEO Data |
| `PLATFORM_API_TO_JOBS_TOKEN` | Platform API и Jobs HTTP |
| `JOBS_TO_SEO_DATA_TOKEN` | Jobs HTTP, import worker и SEO Data |
| `PLATFORM_API_TO_REALTIME_TOKEN` | Platform API и Realtime general HTTP |

Dedicated `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`,
`PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`, `JOBS_TO_SEO_RANK_TOKEN`,
`JOBS_TO_SEO_RANK_RESULT_TOKEN`, `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`,
`JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN`,
`JOBS_TO_PLATFORM_AUTOMATION_TOKEN`,
`REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN` и
`JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`
сохраняют отдельные audiences. Наличие general credential не разрешает
вызов dedicated route group.

Service token должен быть generated distinct значением длиной `32..512`
visible ASCII без whitespace, control characters и comma. Известные example
placeholders и повтор одного значения между configured tokens отклоняются на
startup. HTTP guard принимает один exact header, отклоняет duplicate, array и
combined значения и сравнивает token timing-safe. Любой internal client,
который передаёт credential, обязан запрещать redirect; реализованные clients
используют `redirect: "error"`, чтобы token не попадал на другой origin.

Deploy дополнительно обязан выполнить один общий fail-closed preflight до
старта credential-bearing processes. Текущий Compose one-shot
`service-token-preflight` получает четырнадцать service tokens,
`RANK_HISTORY_CURSOR_KEY`, восемь Redis passwords и пять NATS passwords,
проверяет все 28 credentials на глобальную pairwise distinctness и отклоняет
placeholders.
Для каждого NATS client password deploy также обязан предоставить canonical
bcrypt verifier с canonical `$2a$` prefix и cost `11`; пять verifier
записи должны быть разными, а broker не должен получать plaintext passwords.
На Dokploy transport boundary допускается также точная escaped-форма
`$$2a$$11$$…`: preflight и renderer нормализуют её до canonical verifier до
валидации, сравнения и записи runtime config. Смешанное либо иное malformed
экранирование остаётся fail-closed.
Пять NATS usernames отдельно
проверяются на unique ASCII identifier и несовпадение с любым credential. В
отличие от runtime-контракта secrets
допускают только URL-safe `[A-Za-z0-9._~-]` длиной `32..512`; NATS password
дополнительно начинается с ASCII letter. Контейнер работает без сети,
read-only, с `cap_drop: ALL` и `no-new-privileges`, не выводит значения/хэши и
сообщает только имена конфликтующих либо неверных переменных. Application
processes и NATS стартуют только после его успешного завершения.

## 9. Шифрование и ключи

- TLS 1.2+; предпочтительно TLS 1.3.
- Внутренний traffic не публикуется наружу; sensitive межхостовой traffic шифруется.
- PostgreSQL, Redis, NATS и object storage требуют authentication.
- Redis runtimes разделены на Jobs и Realtime instances с
  independent internal-only networks. Default user выключен; health user
  разрешён только `PING`. Jobs identities ограничены exact versioned BullMQ
  key patterns, Realtime identity — exact versioned Socket.IO channels без key
  access. ACL содержит только password hashes и генерируется в tmpfs до
  старта server.
- NATS использует разные deny-by-default identities для generic runtime,
  Platform API publisher, Realtime consumer, Jobs auth-email consumer и
  topology provisioner. Runtime
  apps получают только exact event/API/request-reply/fetch/ack/DLQ rights;
  topology CREATE/UPDATE принадлежит one-shot provisioner, а DELETE/PURGE/
  raw message read не выдаются.
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
  `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`; general
  `PLATFORM_API_TO_REALTIME_TOKEN` не даёт доступ к этой границе. Endpoint
  принимается только по exact HTTPS origin allowlist без IP literals,
  credentials, fragment и custom ports.
- VAPID private key запрещён в Platform API, Realtime management HTTP, Web,
  browser bundle, Compose текущего среза, logs и обычных application config
  dumps. Его получает только будущий sender role; резервная копия допустима
  только внутри защищённого versioned secret store.
- Revoke/expiry browser device обязан в одной транзакции очистить ciphertext,
  nonce/tag и fingerprints. Producer, bounded Platform API outbox publisher,
  Realtime durable JetStream consumer, tombstone и fail-closed upsert
  реализованы по ADR-2026-036. Source ack происходит после local commit;
  exhausted/permanent failure использует redacted DLQ. Этот identity safety
  pipeline не содержит VAPID private key и не включает внешнюю доставку.
- Transactional auth-email source events не содержат recipient, plaintext
  token, action URL или content. JIT material доступен только отдельному
  `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`; action token находится во fragment и
  не сохраняется в Jobs DB/NATS/logs. `jobs_auth_email_runtime` получает
  только `SELECT/INSERT/UPDATE` одной delivery table, а worker — dedicated
  NATS/Platform/SMTP capabilities без Redis/general/vault/rank/S3 secrets.
  Deploy передаёт ему только `AUTH_EMAIL_SMTP_*`, маппинг в локальные
  `SMTP_*` выполняется на process boundary; общий SMTP credential set с
  другими process boundaries запрещён.
- KEK rollout выполняется в порядке expand keyring → startup decrypt-canary
  verify configured ∪ used versions → drain старых replicas → switch active.
  `MANAGEMENT` создаёт отдельный synthetic known-plaintext envelope каждой
  configured KEK version и регистрирует его expand-only. Строка immutable и
  не содержит tenant/provider/credential identity; повторная регистрация той
  же version возвращает исходный ciphertext, поэтому replacement bytes не
  могут подменить canary. `EXECUTION` до создания queue worker передаёт broker
  все configured versions (не более 128) и получает их объединение с реально
  используемыми versions и usage marker. Каждый configured, в том числе новый
  ещё не active KEK, проверяется на каждой replica; used-but-unconfigured и
  missing/corrupt/wrong-key canary останавливают startup. Retired unused
  historical canary не возвращается и не удерживает старый ключ. Пустой vault
  допустим. Ошибка содержит только `keyVersion`. Validation worker выполняет
  job-only bounded retry без изменения credential при runtime decrypt failure,
  поэтому не создаёт массовый `DISABLED`. Runtime failure попадает в
  error-level operational alert; отдельный cluster-wide circuit breaker ещё
  не реализован.
- Vault endpoints не принимают general `PLATFORM_API_TO_JOBS_TOKEN`:
  отдельный caller secret доступен только Platform API и credential-capable
  HTTP process, до плановой замены на service JWT/mTLS.
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
- `/admin` не индексируется и защищён rate limiting/MFA/recent auth.

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
- server-only application clients не попадают в browser bundle;
- единый основной домен не означает общий cache: public и `/app` имеют
  разные cache keys/policies и automated tenant leak tests.
- Текущая общая Next.js policy Web устанавливает `nosniff`, `DENY`/
  `frame-ancestors 'none'`, `strict-origin-when-cross-origin` и отключает
  ненужные camera/geolocation/microphone/payment/USB capabilities. Она не
  задаёт `Cache-Control` или `X-Robots-Tag` публичному marketing/Toolbox
  дереву; отдельный `/app/:path*` rule задаёт private/no-store/noindex, а
  Service Worker остаётся `no-cache` и ограничен scope `/app/`.
- Текущий CSP намеренно содержит только безопасный независимый directive
  `frame-ancestors 'none'`: script/style CSP нельзя угадывать без полного
  inventory Next.js assets. Полный nonce/hash CSP без `unsafe-eval`
  остаётся отдельным release gate.
- Admin shell независимо от metadata для всех путей возвращает
  private/no-store/noindex и более строгий `no-referrer`; отсутствие
  публичного ingress остаётся обязательной первой границей.
- Production Web/Admin artifacts добавляют HSTS на год с
  `includeSubDomains`, без `preload`. Заголовок имеет силу для браузера только
  поверх HTTPS; включение требует предварительной проверки всех поддоменов.

## 14. API security

- Platform API применяет до controller глобальный fail-safe response policy:
  кроме exact public GET/HEAD health/system allowlist, auth, tenant, internal,
  parser/guard/exception и 404 responses всегда получают
  `Cache-Control: private, no-store` и объединённый
  `Vary: Authorization, Cookie, Origin` с preflight dimensions.
- Jobs Integrations и SEO Data применяют ту же fail-safe границу ко всем
  ответам без public allowlist: health, internal, parser/guard/error и 404
  всегда `private, no-store`, а существующие cache/Vary headers нельзя
  ослабить или потерять. Эти internal-only HTTP процессы не доверяют
  `X-Forwarded-*`; proxy trust включается только для реально стоящего за
  одним reverse proxy edge-сервиса.
- Realtime как edge HTTP/WebSocket process доверяет ровно одному ближайшему
  reverse proxy hop. Его HTTP success/parser/guard/error/404 и CORS preflight
  ответы также принудительно private/no-store с merge-safe Vary; production
  HSTS выставляется только для effective HTTPS и удаляется с HTTP-ответа даже
  при попытке controller задать его самостоятельно.
- Все Platform API responses получают `nosniff`, `DENY`/
  `frame-ancestors 'none'`, `no-referrer` и отключение ненужных browser
  capabilities. В production HSTS добавляется только когда effective
  Fastify protocol является HTTPS. Backend доверяет ровно одному ближайшему
  reverse-proxy hop, а не произвольной forwarded chain; прямой internal HTTP
  не маскируется под TLS.
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
- Транзитивные CLI-зависимости также входят в production audit: даже если
  конкретный database driver не используется runtime-топологией, известная
  high vulnerability устраняется точным workspace override и lockfile.
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
- автоматический credential refresh не меняет validation proof активного
  manual rank Job; реальный configuration/credential drift диагностируется
  как `ESTIMATE_STALE`, а не `INTERNAL_ERROR`;
- bounded 20-attempt preparation и terminal
  `ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` без ложного `NOT_SEALED`;
- credential encryption;
- webhooks;
- object upload;
- frontend BFF/content boundaries.

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

Версионируемый mutating public API smoke создаёт отдельные синтетические
workspace, два проекта, семантические запросы и personal token. Он проверяет
create/list/update/rotate/revoke без повторной выдачи secret, немедленное
применение scopes и allowlist, запрет cross-project/cross-workspace, отсутствие
cookie fallback при неверном Bearer, session-only token management,
identifier-free discovery с запретом cookie-session, semantic read/write,
tracking context, rank estimate/run и optimistic общий порядок проектов.
Полный provider run обязан либо перейти в `202`, либо вернуть
явный billing/provider blocker; тест не принимает ложный success. Скрипт
требует отдельного подтверждающего env-флага и не печатает token material.

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
- PostgreSQL 18 fresh service-role proof: runtime CRUD/UUIDv7/constraints,
  отсутствие DDL/ownership/membership/`PUBLIC`/`_prisma_migrations`/
  cross-database/replication bypass и точный HBA login smoke;
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
  `20260729230200_rank_connector_executions`,
  `20260730101500_rank_connector_execution_claim`,
  `20260730101700_rank_connector_submitting_enum` и
  `20260730101800_rank_connector_submit_authorization` прошли PostgreSQL 18
  fresh full-chain и upgrade rehearsal, tenant-FK/state-matrix/deferred
  one-to-one negative smoke, exact non-owner permission proof и реальные
  claim/authorize race checks. Runtime/provider request/status/result и
  DB-backed lifecycle после `SUBMITTING` проверяются отдельным production
  gate.
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
- на single-node Dokploy старте `platform_db`, `seo_db`, `realtime_db` и
  `jobs_db` получают отдельные compose database backup jobs с раздельными S3
  prefixes и разнесённым cron; это logical dump baseline, а не замена PITR;
- шифрование;
- offsite copy;
- retention tiers;
- checksum/verification;
- quarterly restore drill минимум, чаще на раннем этапе;
- схема и migration history входят в recovery.

### 29.2. Redis/NATS/object storage

- Jobs Redis использует AOF/everysec, dedicated volume и `noeviction`, но не
  считается единственным источником domain truth; dispatcher восстанавливает
  due work из PostgreSQL после потери notification. Write-heavy AOF rewrite
  может приблизиться к двукратному normal memory footprint, поэтому текущие
  defaults ограничивают data `maxmemory=256 MiB` при container cap `768 MiB`;
  representative load и target-host OOM evidence остаются release gate.
- Realtime Pub/Sub намеренно ephemeral. Его потеря не должна уничтожать
  authoritative state; recovery должна проверяться
  degraded/reconnect тестами.
- Перед переключением legacy `redis_data` обязателен operator-reviewed
  drain/migration plan; автоматическое удаление или silent reuse запрещены.
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

### 32.1. Реализованный Telegram-канал внутренних ошибок

Production Compose и одноузловой VPS runtime имеют private receiver на порту
`4004`. Он принимает только exact JSON envelope версии 1 с allowlisted
`service/source/code/severity/fingerprint`, отдельным
`OPERATIONAL_ALERT_TOKEN`, лимитом тела 2 KiB и timing-safe проверкой
авторизации. Произвольный текст исключения, request body, tenant/provider
payload, URL и credential передать через этот контракт нельзя.

В Telegram уходят:

- unexpected child start/exit/stop;
- stderr-строки, классифицированные как error/fatal/uncaught/unhandled, только
  в виде локального SHA-256 fingerprint;
- uncaught exception monitor backend supervisors;
- ошибки Next request handler и Realtime upgrade proxy.

Ожидаемые domain `4xx`, validation failures и пользовательские provider
statuses не являются внутренними инцидентами и не алертятся. Неизвестный `5xx`
должен попасть в structured error log и далее в supervisor alert.

Telegram bot token получает только alert-receiver process; Frontend и
Execution получают лишь внутренний URL и dedicated token. Receiver делает
outbound HTTPS к фиксированному `api.telegram.org`, не следует redirect,
использует timeout 5 секунд, подавляет одинаковый fingerprint на 5 минут и
ограничивает канал двадцатью сообщениями за 5 минут. Сбой доставки создаёт
только generic локальную диагностику без bot token и исходной ошибки.

При `TELEGRAM_ALERTS_ENABLED=true` bot token, chat ID и optional topic ID
валидируются fail-closed на startup. Release evidence обязано включать canary
из `infrastructure/runbooks/operational-alerts.md`; сообщение в Telegram не
является источником истины и не заменяет logs/metrics/traces.

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
- Repository configs/startup scripts запекаются в versioned images; data
  хранится в named volumes, пригодных для Dokploy Volume Backup, без bind mount
  на transient Git checkout.
- Automated database migration не запускается конкурентно несколькими replicas.
- Application process стартует только после успешных owner migration и
  post-migration least-privilege grants; owner password application process не
  получает.
- Worker roles изолированы отдельными child processes внутри
  `backend-execution`; process count и role concurrency настраиваются
  независимо. При подтверждённой метриками необходимости тот же artifact
  допускается запустить отдельным process profile/replica.
- Domains/TLS настраиваются через Dokploy reverse proxy.
- Internal databases не получают public domain.
- Deployment history и rollback image сохраняются.
- Dokploy и VPS config экспортируются/документируются так, чтобы восстановление не зависело от единственного UI.
- Для каждой из четырёх PostgreSQL databases настроен S3 backup, выполнен
  ручной test и restore drill; Jobs Redis/NATS named-volume backup не считается
  заменой authoritative PostgreSQL backup.

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
  Минимальная connector DB role получает только exact
  claim/authorize/runtime grants; provider runtime запускается именно под
  этой role. Общий Jobs DB user credential material не получает;
- grant service сохраняет intent/decision и атомарную secret-free
  `CONSUMED/READY_TO_SUBMIT` пару, dispatcher вызывает его по sealed chunks,
  а submit flag разрешён только connector-worker;
- SECURITY DEFINER claim/authorize/runtime DDL реализован, `PUBLIC EXECUTE`
  отозван. Authorize атомарно фиксирует `SUBMITTING` и durable
  may-have-started marker; provider wire/task/poll/normalized state хранится
  через lease-fenced brokers. Raw provider body не пишется в БД, логи,
  события или queue payload. Live BYOK smoke и успешный Telegram canary
  остаются обязательным release evidence; сам operational alert runtime уже
  является частью versioned topology.
- connector child дополнительно получает только dedicated
  `JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN`; rank-worker, Jobs HTTP и
  остальные process types его не получают. Для синхронного XMLStock порядок
  фиксирован как HOLD → provider HTTP → CAPTURE → local checkpoint/result.

### 34.3. Jobs process capability isolation

Один Jobs image разворачивается с отдельными commands и exact env allowlists:

- HTTP получает DB/Redis, NATS, S3, general Platform API/SEO Data
  tokens и credential management token/keyrings;
- import получает DB/Redis/S3 и только SEO Data URL/token;
- inspection получает DB/Redis/S3 и malware scanner;
- system worker получает только Redis и concurrency, без DB и service secrets;
- rank получает DB/Redis и два dedicated rank credentials;
- connector получает `jobs_connector`, Redis, execution KEK и dedicated Core
  billing-settlement token;
- auth-email получает `jobs_auth_email_runtime`, dedicated NATS consumer,
  Platform JIT token и SMTP; Redis и остальные capabilities запрещены.

Явная process role проверяется до создания application/worker dependencies.
Лишний NATS/S3/SMTP/malware/service/vault credential либо enable flag
останавливает process. Static Compose regression проверяет exact effective env
keys и recipients, включая отсутствие legacy credential. Эта защита
закрывает accidental secret fan-out, но не заменяет container/DB/Redis ACL,
  target-image Redis startup compatibility, host egress policy,
  runtime authorization
  и incident controls.

Credential-bearing application processes и NATS зависят от успешного one-shot
`service-token-preflight`. Redis servers сами ждут preflight, поэтому Redis-only
system, inspection и connector transitively не стартуют до проверки, не
получая при этом чужие credentials. Preflight проверяет deploy input, а
process-role loaders продолжают независимо проверять собственный effective
env.

Auth-email rollout выполняется expand-first: contracts/migration/DB grants и
NATS topology, затем Platform JIT/publisher, затем worker только после
operator-managed SMTP canary. Production SMTP secrets в repository
отсутствуют. Rollback сначала останавливает новые publish/send и drain-ит
worker, но не удаляет stream, durable consumer, outbox или delivery attempts.
SMTP accept не атомарен с DB: crash до durable `SMTP_ACCEPTED` может дать
повтор со stable `Message-ID`; обязательны ambiguity alert, reconciliation и
fault-injection runbook, а exactly-once запрещено заявлять.
Readiness marker создаётся только после успешного worker bootstrap и
удаляется до прекращения fetch/drain. `stop_grace_period` должен быть строго
больше worst-case bounded shutdown budget, включая
`AUTH_EMAIL_SHUTDOWN_GRACE_MS`.

## 35. Maintenance

Периодические задачи:

- partitions;
- vacuum/analyze monitoring;
- index bloat/reindex planning;
- expired uploads/exports cleanup;
- old session/token cleanup;
- bounded global refresh-session expiry sweeper, который использует тот же
  family revoke/outbox helper; текущий Platform API runtime реализует его и
  требует включённым в production, а target PostgreSQL load/concurrency smoke
  остаётся release gate;
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
- ручная регистрация требует platform-admin role, MFA и audit;
- официальный receipt URL/ID сверяется с payment amount и buyer snapshot;
- receipt delivery contact защищается как PII;
- webhook payload ЮKassa проходит authentication, idempotency и reconciliation;
- чек не отменяется до подтверждённого refund;
- automated adapter разрешён только при официальном доступе ФНС/оператора.

## 37. Operational admin

Администратор видит:

- каталог проектов с workspace, автором, владельцем и количеством активных
  ключей/пользовательских папок;
- глобальный журнал операций с фильтрами active/completed/attention, типом,
  прогрессом, безопасными итоговыми счётчиками и нормализованным error code;
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

Каталог и журнал доступны только через отдельный platform-role/recent-MFA
boundary и являются read-only. Core не читает чужие service databases: SEO
Data считает семантику внутри `seo_db`, Execution строит bounded keyset page
внутри `jobs_db`, а Core добавляет только display identity из `platform_db`.
Частичный отказ SEO Data не скрывает проекты и обозначается degraded state.
Операционный ответ никогда не содержит job input/scope snapshot, keyword
texts, provider raw response, credential material или произвольный error
payload. Разрешены только status/stage/provider, прогресс, allowlisted числовые
результаты, стоимость и нормализованный error code.

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
- KEK rollout canary проверяет точное key material configured ∪ used versions;
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
