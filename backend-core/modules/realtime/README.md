# Realtime

Доставка presence, курсоров, выделений, комментариев и совместных документов.

Foundation-инкремент включает Socket.IO с Redis adapter, NATS, отдельную Prisma
схему и health endpoints. Вход в tenant/project rooms намеренно закрыт до
реализации проверки access token, membership и permission snapshot.

## Durable terminal session revoke

Realtime подписан только на allowlisted событие
`identity.session-family.revoked.v1`. Pull consumer получает не более одного
сообщения, проверяет exact subject и общий parser из `packages/contracts`, а
затем вызывает `SessionFamilyRevocationService`. Source ack подтверждается
только после commit локальной транзакции `inbox + tombstone + device revoke`;
идемпотентный duplicate также ack-ится после чтения committed inbox.

Временная DB-ошибка делает delayed NAK с bounded exponential backoff и
детерминированным jitter. После `NATS_EVENT_MAX_ATTEMPTS` сообщение попадает в
`NATS_EVENT_DLQ_SUBJECT`; malformed/subject/scope/invariant ошибки идут туда
сразу. DLQ envelope содержит только fixed failure code и transport reference,
но не исходный payload, user/session/event IDs, PII или error message. Source
ack выполняется только после проверенного JetStream PubAck от exact DLQ stream.
При недоступном DLQ source остаётся unacked/NAK для повторной доставки.

Runtime не создаёт и не изменяет JetStream topology. Startup и каждый
readiness check fail-closed проверяют два exact singleton streams и durable
pull consumer: exact source filter, explicit ack, `deliver all`, instant
replay, `ack_wait=60s`, `max_ack_pending=1`, unlimited transport redelivery,
file-backed state и отсутствие server backoff. Production требует:

- `NATS_EVENT_CONSUMER_ENABLED=true`;
- `NATS_EVENT_ENVIRONMENT` — canonical lowercase environment token;
- `NATS_EVENT_STREAM=IDENTITY_EVENTS`;
- `NATS_EVENT_CONSUMER_DURABLE=realtime_session_family_revoked_v1`;
- `NATS_EVENT_DLQ_STREAM=DOMAIN_EVENTS_DLQ`;
- `NATS_EVENT_DLQ_SUBJECT={environment}.dlq.realtime.identity.session-family.revoked.v1`.

Fetch, retry, PubAck timeout, попытки, payload size и shutdown grace имеют
bounded env-настройки из `.env.example`. Shutdown закрывает активный bounded
fetch до drain NATS и после конечного grace оставляет незавершённый source
unacked вместо бесконечной блокировки остановки процесса.

Runtime entrypoint: `backend-core/src/realtime.main.ts`, порт по умолчанию
`4003`. В development Realtime по умолчанию слушает только `127.0.0.1`;
`BIND_ADDRESS` принимает только
`127.0.0.1` или `0.0.0.0`. Контейнерный Compose явно задаёт `0.0.0.0` внутри
изолированной сети, а host-preview обязан оставаться на loopback. Если
`WEB_ORIGINS` не задан вне production, разрешён только канонический локальный
Web origin задаётся явно через `WEB_ORIGINS`.
