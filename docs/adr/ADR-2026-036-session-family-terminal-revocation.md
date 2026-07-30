# ADR-2026-036: атомарный terminal revoke session family

Дата: 29 июля 2026 года
Статус: принято
Затронутые репозитории: `platform-contracts`, `platform-api`,
`platform-realtime`

## Контекст

Browser Web Push device хранит snapshot session family. До включения внешней
доставки Realtime должен получать надёжный факт terminal-отзыва семейства и
атомарно отзывать связанные устройства. Ранее Platform API отзывал отдельные
строки `sessions` в нескольких местах и не создавал единый domain event.
Конкурентные refresh rotation, password reset, MFA disable и login могли
принимать решения по устаревшему snapshot до начала транзакции.

Обычная rotation внутри действующего семейства не является terminal revoke:
она заменяет один refresh token другим и не должна отключать устройство.
Истечение короткого access token также не завершает refresh family.

## Решение

### Единая блокировка и выдача

- Все security-значимые writers lifecycle сессий используют один
  PostgreSQL transaction advisory lock, namespaced по `userId`:
  `pg_advisory_xact_lock(hashtextextended('identity-session-user:' + userId, 0))`.
- Lock берётся внутри DB transaction. In-memory mutex и Redis lock источником
  истины не являются.
- `issue` после lock повторно читает пользователя и требует точного совпадения
  `id + expected version + ACTIVE`. Поэтому login или MFA challenge,
  начавшийся до password reset/MFA change/suspend, не может создать сессию
  после изменения account snapshot.
- Password login берёт тот же lock до создания MFA challenge. Проверка
  challenge берёт lock до его поглощения.
- TOTP setup/activation/disable и session revoke/revoke-others под lock
  повторно требуют active/unexpired principal session с точным
  `sessionId + userId + sessionFamilyId`; MFA activation/disable дополнительно
  проверяют expected user version. Guard snapshot до транзакции недостаточен.
- Password reset берёт lock до изменения пользователя, поглощает reset token,
  инвалидирует все незавершённые login MFA challenges, отзывает все distinct
  старые families и только затем создаёт новую family в той же транзакции.
- Outbox error не перехватывается: он откатывает session mutation и всю
  вызывающую транзакцию.

### Общий terminal helper

Platform API использует один transactional helper:

1. берёт user advisory lock;
2. выбирает distinct active `familyId` только данного пользователя с
   optional include/exclude;
3. одним `revokedAt` условно обновляет только строки `revokedAt IS NULL`;
4. для каждой family, где реально изменилась хотя бы одна строка, создаёт
   ровно один outbox event.

Семантика команд:

- logout отзывает всю family refresh session;
- `DELETE /sessions/{sessionId}` сначала находит target с условием
  `id + userId`, затем отзывает всю его family; чужая либо уже terminal family
  возвращает прежнее состояние `NOT_FOUND`;
- revoke others исключает всю `principal.sessionFamilyId`, а не только одну
  строку текущей session;
- MFA disable также исключает всю текущую family;
- password reset отзывает все distinct старые families;
- refresh reuse после rotation и полное истечение refresh session сначала
  commit-ят terminal revoke/outbox, затем возвращают `UNAUTHENTICATED` вне
  transaction callback;
- неактивный account, обнаруженный refresh path, выполняет такой же lazy
  terminal revoke. Будущая suspend/deactivate команда всё равно обязана
  производить события сама, а не полагаться на lazy path;
- rotation текущей family обновляет заменённую строку без terminal event;
- expiry access token не создаёт terminal family event.

### Контракт события

Добавляется `identity.session-family.revoked.v1`.

- `aggregate.type = "session-family"`;
- `aggregate.id = sessionFamilyId`;
- `aggregate.version = 1`;
- workspace/project отсутствуют;
- payload содержит строго:

```json
{
  "userId": "019...",
  "sessionFamilyId": "019...",
  "revokedAt": "2026-07-29T15:30:45.123Z"
}
```

Причина, session ID, email, IP, user agent, access/refresh/CSRF token и любое
credential material запрещены. Контракт находится в `platform-contracts`.
Новые `sessionFamilyId` генерируются dependency-free как UUIDv7 по RFC 9562,
поскольку family становится межсервисным aggregate ID. Существующие UUIDv4
остаются допустимыми lookup IDs и не требуют backfill/migration.

### Durable transport и global expiry

- Platform API publisher выбирает из outbox только exact
  `identity.session-family.revoked.v1` через `FOR UPDATE SKIP LOCKED`, строит
  envelope общим contract builder и fail-closed проверяет aggregate, scope и
  metadata до network call.
- JetStream publish использует exact subject
  `{environment}.identity.session-family.revoked.v1`, `Nats-Msg-Id`, равный
  outbox event ID, и expected stream `IDENTITY_EVENTS`. Outbox становится
  `PUBLISHED` только после валидного PubAck этого stream; ошибки получают
  bounded retry с jitter либо terminal `FAILED` после configured budget.
- Realtime использует durable pull consumer
  `realtime_session_family_revoked_v1`, получает не более одного сообщения и
  ack-ит source только после commit локального handler. Временная ошибка даёт
  bounded delayed NAK. Permanent invalid message либо exhausted application
  attempts сначала получает redacted DLQ envelope в `DOMAIN_EVENTS_DLQ`, и
  только подтверждённый DLQ PubAck разрешает source ack.
- Runtime publisher/consumer не создают topology. Internal-only one-shot
  provisioner до их старта идемпотентно создаёт exact source/DLQ streams и
  durable consumer, reconciles только allowlisted limits и fail-closed
  отклоняет identity, subject, transform, mirror/source либо sealed drift.
  Publisher, consumer, provisioner и generic NATS runtime используют разные
  deny-by-default credentials/ACL.
- Bounded global session-expiry sweeper выбирает просроченные active families
  небольшими batches, дедуплицирует `userId + familyId`, затем в отдельной
  bounded transaction берёт тот же user lifecycle lock, повторно проверяет
  due state и вызывает общий terminal revoke/outbox helper. Production
  configuration требует publisher, consumer и sweeper включёнными.
- Publisher, consumer и sweeper прекращают scheduling при shutdown и ждут
  только bounded active operation. Realtime закрывает active fetch до NATS
  drain; после shutdown grace незавершённое source сообщение остаётся unacked.

## Последствия

- Terminal session state и producer outbox row фиксируются атомарно в
  `platform_db`.
- Повтор команды не создаёт повторное событие, если ни одна active session row
  не была изменена.
- Advisory lock сериализует lifecycle только одного пользователя и не создаёт
  глобальный bottleneck.
- Для этого exact event type outbox row теперь автоматически проходит через
  durable JetStream publisher и Realtime consumer. Остальные event types не
  входят в allowlist этого publisher и не получают доставку автоматически.
- Realtime application handler и transport связаны без изменения ownership:
  versioned inbox scope, durable revoked-family tombstone, terminal device
  revoke и upsert guard остаются одной локальной transaction boundary.
- Lazy refresh path больше не является единственным механизмом expiry:
  bounded global sweeper закрывает families, которые клиент не предъявил.

## Release blockers и проверка

- Durable outbox publisher и JetStream pull subscription реализованы. Handler
  атомарно записывает scoped inbox receipt, durable revoked-family tombstone и
  переводит active devices совпавшей session family в terminal state до ack.
- Одного update существующих devices недостаточно: событие может быть
  обработано раньше запоздавшего registration request, уже
  аутентифицированного старой family. Realtime хранит tombstone по
  `userId + sessionFamilyId`; device upsert под тем же user/device lock и в
  той же локальной транзакции обязан fail-closed проверить его до записи.
  Поэтому возможны оба порядка без resurrection:
  `registration → event → terminal revoke` и
  `event → tombstone → rejected registration`.
- `inbox_events.scope_key` nullable для совместимости с прежними consumers,
  но этот handler всегда записывает versioned
  `consumer + userId + sessionFamilyId` и отклоняет reuse одного event ID для
  другого scope.
- Tombstone нельзя очищать раньше максимального refresh-session TTL плюс
  допустимая задержка outbox/consumer и пока существует связанный device
  tombstone. Конкретная bounded retention фиксируется вместе с consumer.
- Future account suspend/deactivate/delete command обязан брать тот же
  lifecycle lock, terminal-отзывать все families и писать событие в своей
  транзакции.
- Bounded global session-expiry sweeper реализован; до production остаются
  PostgreSQL 18 concurrency и representative-volume/load checks для него.
- Unit tests фиксируют exact payload, whole-family/idempotent revoke, чужую
  session, exclude current family, stale user version, commit-before-401,
  reset и MFA integration.
- Реальные race tests `rotate ↔ rotate`, `login ↔ password reset`,
  `MFA challenge/confirm/disable ↔ password reset` и outbox rollback выполняются на
  PostgreSQL 18 staging; in-memory тест не считается заменой.
- Localhost smoke с `nats-server` 2.12.12 подтвердил синтаксис config,
  create → unchanged idempotence topology и exact ACL publisher/consumer/
  provisioner. Compose render без Docker на текущем хосте не выполнен и
  остаётся CI/target-environment gate.
- До production сохраняются общеплатформенные gates: target PostgreSQL ACL/
  HBA и race evidence, NATS lag/redelivery/DLQ observability и replay runbook,
  backup/restore/load проверки и внешние provider/sender dependencies. Сам
  durable identity pipeline не означает готовность всего продукта.
