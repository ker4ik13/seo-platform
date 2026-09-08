# ADR-2026-046: коммерческий MVP и оплата provider operations

Дата: 6 сентября 2026. Статус: принято для реализации по ответам владельца.

## Контекст

Владелец подтвердил НПД РФ, RU/EN, YooKassa + Crypto Pay, 50% целевую маржу,
полный паритет системных XMLStock/Arsenkin и BYOK, сохранность production данных.
Существующий usage settlement покрывает только rank, payment adapter — YooKassa.
Дневные тарифные ограничения на BYOK не вводятся.

## Решение

- Core API сохраняет владение пользователями, подпиской, price book, estimate,
  финансовым резервом, ledger, refund requests и налоговыми obligations.
- Execution сохраняет Jobs/JobItems, provider I/O, credential vault и строгие
  lease-fenced brokers. Он не читает Core DB. Core не читает Jobs DB.
- Price book использует integer micro-rubles для себестоимости и целые копейки
  для денежных операций. Цена вычисляется вверх по полной переменной
  себестоимости, target margin и явно заданным резервам. Клиент не задаёт цену.
- Полный workload определяет расход: pages/depth/search source, число вариантов
  частотности и опции кластеризации. «Один keyword» не всегда один provider call.
- User estimate привязан к canonical command hash, actor/workspace/project,
  provider/product и версии цен. Command/price drift требует повторного estimate.
- Новые paid operations получают Core-owned hold и settlement. Execution JIT
  подтверждает scope/lease/items через свой trusted HTTP boundary. Replay не
  списывает дважды; неоднозначный внешний submit не повторяется автоматически.
- Quota admission и UI usage используют одни наборы состояний. Недоступные
  агрегаты обозначаются явно, без подмены нулями. Источник каждого агрегата —
  сервис-владелец. Summary доступен только пользователю с billing.view_plan.
- Crypto Pay использует отдельный payment provider, RUB-denominated invoices,
  raw-body HMAC verification, повторную сверку invoice у provider и общий ledger.
  Его отсутствие recurring/refund API не маскируется возможностями YooKassa.
- Все тарифные изменения — новые immutable versions. Существующие подписки,
  оплата, периоды и данные не удаляются и не обнуляются миграцией.
- Возврат — запрос клиента и решение владельца с проверкой неиспользованной
  стоимости, CAS/idempotency и audit. Пользователь не получает безусловную
  команду самостоятельного возврата всей исторической оплаты.
- NPD generation остаётся выключенной до явного включения; worker имеет
  bounded timeout и не делает повторный income POST после неизвестного результата.
- UI locale — per-user/per-request состояние, без глобальной server locale.
  Пользовательские keywords, заметки и названия не переводятся как интерфейс.

## Развёртывание и откат

Additive migrations, nullable/defaulted новые поля и сохранение старых
контрактов там, где это безопасно. После rollback новых feature flags старые
подписки/Jobs и чтение данных работают; новые финансовые данные не удаляются.
До публикации выполняются Prisma validation/generation, migration review,
PostgreSQL/Redis/E2E/fault-injection и backup restore. Для живых SEO canary
действует отдельный общий предел в пять оплачиваемых requests.

Системные credentials и payment/NPD activation требуют настоящей конфигурации;
отсутствующие внешние условия отображаются в административной готовности релиза.
