# ADR-2026-043: BYOK rank без внутренней дневной квоты

- Статус: принято
- Дата: 6 августа 2026 года
- Затронутые области: Core billing entitlement, rank estimate, execution grant,
  Frontend
- Изменение API/БД: `RankEstimateQuota` получает состояние `UNLIMITED`; схема
  БД не меняется

## Контекст

Первый controlled-beta policy ограничивал рабочую область 200 grant rows в
UTC-сутки и считал каждый keyword/chunk отдельной единицей. Estimate проверял
только наличие хотя бы одной единицы, поэтому большой разрешённый запуск мог
стартовать, обработать остаток квоты и завершиться частично. Например, запуск
на 651 keyword останавливался около 200 и блокировал продолжение до следующего
UTC-дня.

Это ограничение не является лимитом XMLStock или Arsenkin и противоречит
продуктовому правилу: пользователь оплачивает BYOK provider самостоятельно, а
число операций через собственный API-ключ не тарифицируется платформой.

## Решение

- Для активного entitlement Core возвращает rank quota `{ status:
  "UNLIMITED" }`; `NOT_AVAILABLE` сохраняется только при отсутствии
  entitlement projection.
- Production BYOK grant policy не считает дневные rows и не сравнивает их с
  platform limit.
- Каждый новый provider submit по-прежнему требует короткий одноразовый grant,
  актуальные lifecycle/RBAC/entitlement checks и связанную immutable
  `rank_execution_quota_reservations` row. Историческое имя таблицы и FK
  сохраняются для exact replay, аудита и безопасного rollback; row не участвует
  в admission decision.
- Сохраняются максимальный размер одного provider command, тарифная
  concurrency фоновых Jobs, provider rate limiting, credential quota и
  connector capacity.
- Старые `AVAILABLE|EXHAUSTED` snapshots остаются читаемыми. Новые команды
  запускаются с `UNLIMITED`; legacy `AVAILABLE` принимается только для
  совместимости rolling deploy.
- Будущая platform-paid модель может получить отдельную versioned policy с
  balance/credit reservation, не меняя BYOK policy.

## Последствия

Большой rank-run и его дочернее продолжение больше не останавливаются на 200
ключах и не ждут сброса UTC-окна. Provider расходы остаются на владельце BYOK
ключа; защита инфраструктуры обеспечивается concurrency/rate/capacity gates,
а не скрытой суточной квотой. Миграция БД не нужна, поэтому rollback на
предыдущую версию приложения остаётся технически возможным.
