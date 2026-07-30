# ADR-2026-038: выделенная доставка transactional auth-email

- Статус: принято
- Дата: 30 июля 2026 года
- Затронутые области: `platform-contracts`, `platform-api`,
  `platform-jobs-integrations`, `platform-web`, `platform-infrastructure`
- Изменение API/БД: новые internal API contracts, JetStream stream/consumer,
  Jobs-owned delivery table и отдельная runtime DB role

## Контекст

Регистрация, восстановление пароля и workspace invitations уже создают
одноразовые записи в `platform_db`, но внешняя доставка не должна переносить
открытый токен, email или готовую ссылку через outbox, NATS, Redis либо Jobs
database. Состояние пользователя, одноразового токена, приглашения и workspace
может измениться между созданием события и попыткой SMTP. Материал письма
поэтому нельзя считать долговечным payload события.

Общий notification pipeline учитывает profile/project preferences, quiet
hours и digest. Письма подтверждения email, восстановления пароля и
приглашения являются отдельным transactional security flow: они не зависят от
настроек маркетинговых и проектных уведомлений и не означают готовность
общего email/Web Push sender.

JetStream обеспечивает доставку at-least-once, а SMTP не участвует в
транзакции PostgreSQL. Требование exactly-once для внешнего письма технически
невыполнимо без подтверждённой идемпотентности провайдера.

## Решение

### Secret-free событие и transport

Platform API одной транзакцией с доменной командой пишет один из exact events:

- `identity.email-verification.requested.v1`;
- `identity.password-reset.requested.v1`;
- `workspace.invite.requested.v1`.

Envelope и payload находятся в `platform-contracts`. Identity payload
содержит только `userId`, `oneTimeTokenId`, `locale`, `expiresAt`; invite
payload — только `inviteId`, `workspaceId`, `expiresAt`. Email, plaintext
token, action URL, тема и содержимое письма запрещены.

Durable Platform API publisher повторно валидирует outbox row, публикует в
exact subject `{environment}.email.{eventType}` с
`Nats-Msg-Id = outbox event id` и ожидаемым stream `AUTH_EMAIL_EVENTS`.
Статус `PUBLISHED` разрешён только после подтверждённого PubAck этого stream.
Остальные event types не становятся auth-email автоматически.

One-shot provisioner создаёт file-backed `AUTH_EMAIL_EVENTS`, durable pull
consumer `jobs_auth_email_v1` с filter
`{environment}.email.>` и redacted DLQ subject
`{environment}.dlq.jobs.transactional-email.v1` внутри
`DOMAIN_EVENTS_DLQ`. Platform publisher, auth-email consumer и provisioner
имеют разные deny-by-default NATS identities. Runtime не изменяет topology.

### Just-in-time material

Выделенный Jobs worker запрашивает письмо непосредственно перед отправкой:

- `POST /internal/v1/auth-email-deliveries/{eventId}/material`;
- `POST /internal/v1/auth-email-deliveries/{eventId}/complete`.

Routes принимает только Platform API с Jobs по отдельному
`JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`, одному exact request ID, bounded body и
`no-store`; general service credentials эту границу не открывают.

Platform API повторно читает authoritative state из `platform_db`, сверяет
event type, aggregate identity, назначение, exact ID и hash одноразовой записи,
неиспользованный/неотозванный статус, expiry и состояние user/invite/workspace.
Ответ:

- `READY` содержит recipient, locale, expiry и action URL;
- `SKIPPED/NOT_DELIVERABLE` безопасно отменяет устаревшую доставку.

Открытый одноразовый токен восстанавливается только в памяти Platform API,
передаётся worker только в bounded internal response и находится только
во fragment `#token=...` action URL. Он не записывается в outbox, NATS, Jobs
table, queue payload, логи или метрики. Completion принимает только
`DELIVERED` или `BOUNCED`: для workspace invite Platform API идемпотентно
выполняет актуальный `SENT → DELIVERED|BOUNCED`. `BOUNCED` разрешён worker
только для hard recipient rejection после подтверждённого redacted DLQ
PubAck. Identity completion не изменяет одноразовую запись.

### Durable Jobs attempt и идемпотентность

Отдельный entrypoint `auth-email-worker.main.ts` использует только:

- `jobs_db` через `jobs_auth_email_runtime`;
- dedicated NATS consumer identity;
- dedicated Platform material/completion token;
- auth-email-only SMTP configuration и непубликуемую outbound network.

Redis, general Jobs tokens, credential vault, S3, malware и rank secrets
этому process запрещены. DB role получает `SELECT/INSERT/UPDATE` только на
Jobs-owned `auth_email_delivery_attempts` и не имеет доступа к остальным Jobs
tables. General `jobs_runtime` не получает эту таблицу.

Deploy принимает SMTP material только через `AUTH_EMAIL_SMTP_*` и маппит его
в process-local `SMTP_*`. Directus принимает отдельные `DIRECTUS_SMTP_*`;
общие SMTP credentials между приложением и CMS запрещены.

Одна immutable source identity сохраняется по unique `source_event_id` вместе
с exact event type и SHA-256 canonical envelope. Повтор того же события
возвращается к той же строке; reuse event ID с другим type/hash fail-closed
отклоняется. Состояния `PENDING`, `SENDING`, `RETRY_SCHEDULED`,
`SMTP_ACCEPTED`, `DLQ_PENDING`, `COMPLETED`, `CANCELLED` и `FAILED_FINAL`
защищены DB constraints/triggers, versioned CAS и lease. Recipient, token,
action URL, тема и body не сохраняются.

Retryable material/SMTP failures получают bounded exponential backoff с
deterministic jitter. Exhausted delivery сначала сохраняется как
`DLQ_PENDING`; только подтверждённый redacted DLQ PubAck разрешает
`FAILED_FINAL`. Hard recipient rejection после DLQ PubAck дополнительно
фиксирует Platform completion `BOUNCED`. Invalid source
payload/metadata/subject также публикуется в
redacted DLQ без raw payload, recipient, event data либо transport error.
Source ack выполняется только после durable local outcome; shutdown оставляет
незавершённое сообщение доступным для redelivery.

### SMTP ambiguity

После принятия сообщения SMTP server и до commit `SMTP_ACCEPTED` возможен
crash. После lease expiry worker не может доказать, было ли письмо доставлено,
и может выполнить одну повторную отправку. Для каждого source event
используется стабильный RFC `Message-ID`, чтобы дать SMTP/provider
best-effort сигнал дедупликации, но это не exactly-once гарантия.

После durable `SMTP_ACCEPTED` повтор не отправляет SMTP заново: worker
повторяет только invite completion и terminal local commit. Provider message
ID хранится без recipient/body/token. Операторский reconciliation и метрика
неоднозначных/повторных попыток обязательны до публичного production.

### Browser links

Web принимает только один bounded `token` во fragment, немедленно удаляет
fragment через `history.replaceState` и только затем вызывает same-origin BFF.
Потоки реализованы для email verification, password reset и
`/app/workspace-invites/accept`. Invite может временно хранить токен в
`sessionStorage` для завершения auth redirect; persistent storage и query
parameter запрещены.

## Последствия

- Authoritative lifecycle остаётся в Platform API; Jobs не читает
  `platform_db` и не хранит reusable secret material.
- At-least-once source delivery не создаёт несколько durable attempts для
  одного exact event.
- Общие notification preferences, digest и Web Push delivery не смешиваются с
  обязательным transactional auth-email flow.
- SMTP availability становится явной операторской зависимостью. Production
  SMTP credentials не находятся в Git/примерах и должны быть отдельно
  настроены в защищённом secret store deployment.
- Система не заявляет exactly-once внешнюю доставку и сохраняет честный
  crash-after-SMTP ambiguity.

## Rollout

1. Expand: применить contracts, Jobs migration и отдельную DB role/grants;
   создать NATS stream/consumer/DLQ и dedicated identity; проверить ACL без
   запуска worker.
2. Развернуть Platform API с JIT material/completion routes и publisher
   allowlist. До worker события безопасно остаются в outbox/JetStream.
3. Оператор отдельно задаёт уникальные
   `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN`, Jobs DB/NATS credentials,
   sender/message-ID domain и `AUTH_EMAIL_SMTP_*` credentials/timeouts. В
   repository production SMTP secrets отсутствуют.
4. Запустить один auth-email worker, проверить no-secret logs, material
   `SKIPPED`, SMTP sandbox delivery, invite completion, retry, DLQ и restart
   после каждого durable state.
5. После canary включать нагрузку постепенно и добавить lag/redelivery/DLQ,
   SMTP latency/error и delivery-state alerts.

Worker создаёт container-local readiness marker только после успешного
bootstrap обязательных dependencies и удаляет его до остановки fetch/drain.
Container `stop_grace_period` обязан быть строго больше worst-case bounded
shutdown budget worker, включая `AUTH_EMAIL_SHUTDOWN_GRACE_MS`; иначе Compose
может послать принудительный kill до безопасного завершения ack/lease path.

## Rollback

- Сначала остановить publisher новых auth-email events и gracefully drain
  worker; незавершённые source messages остаются в JetStream/Jobs table.
- Не удалять stream, durable consumer, outbox rows, delivery attempts,
  migration или DB role в аварийном rollback. Они нужны для evidence и
  последующего exact replay/reconciliation.
- Platform JIT endpoints можно оставить недоступными внешним callers:
  dedicated token и internal network сохраняют границу.
- После исправления повторно развернуть совместимые Platform/worker versions и
  продолжить с сохранённых states. Ручной resend требует operator review,
  поскольку `SENDING` после crash может означать уже принятое SMTP письмо.
- Секреты ротируются отдельной expand/switch/retire процедурой; rollback не
  возвращает скомпрометированное значение.

## Release blockers и проверка

- Production SMTP provider/account/sender domain и credentials должны быть
  настроены оператором и проверены sandbox/canary; наличие кода и пустых env
  slots этого не подтверждает.
- Обязательны target PostgreSQL 18 migration/role/constraint proof,
  NATS topology/ACL smoke, restart/fault-injection для каждого state,
  crash-after-SMTP reconciliation rehearsal и проверка redacted logs/DLQ.
- Нужны alerts и runbook для outbox lag, consumer lag/redelivery,
  `DLQ_PENDING`, exhausted attempts, SMTP ambiguity и provider outage.
- Contracts, Platform API, Jobs worker, Web fragment flow, lint, tests и
  production builds проходят общую release matrix. External SMTP delivery
  проверяется отдельно с disposable/sandbox recipient.
- Общий notification email/Web Push sender, digest, bounce/complaint policy и
  delivery history остаются отдельным незавершённым срезом.
