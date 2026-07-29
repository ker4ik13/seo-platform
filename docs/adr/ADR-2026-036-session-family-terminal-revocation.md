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

## Последствия

- Terminal session state и producer outbox row фиксируются атомарно в
  `platform_db`.
- Повтор команды не создаёт повторное событие, если ни одна active session row
  не была изменена.
- Advisory lock сериализует lifecycle только одного пользователя и не создаёт
  глобальный bottleneck.
- Producer-срез dependency-free: publisher JetStream не добавлен, поэтому
  наличие outbox row ещё не означает автоматическую доставку события.
- Realtime dependency-free application handler уже добавлен вместе с Prisma
  migration: versioned inbox scope, durable revoked-family tombstone,
  terminal device revoke и upsert guard используют один user advisory lock.
  Handler ещё не подключён к durable transport subscription.

## Release blockers и проверка

- Durable outbox publisher и JetStream subscription должны доставлять
  validated envelope в готовый идемпотентный Realtime application handler до
  включения Web Push sender. Handler атомарно записывает scoped inbox receipt,
  durable revoked-family tombstone и переводит все active devices с
  совпавшей session family в terminal state.
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
- Нужен bounded global session-expiry sweeper: lazy refresh покрывает только
  предъявленную session.
- Unit tests фиксируют exact payload, whole-family/idempotent revoke, чужую
  session, exclude current family, stale user version, commit-before-401,
  reset и MFA integration.
- Реальные race tests `rotate ↔ rotate`, `login ↔ password reset`,
  `MFA challenge/confirm/disable ↔ password reset` и outbox rollback выполняются на
  PostgreSQL 18 staging; in-memory тест не считается заменой.
