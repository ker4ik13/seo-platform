# ADR-2026-052: пакетный контроль исполнения и центральная БД

- Статус: частично реализуется локально; полный cutover не принят
- Дата: 29 сентября 2026 года
- Затронуто: Jobs, rank/Wordstat/AI/cluster/crawl/import/export/inspection,
  Platform grant и billing, Core SEO, Worker Gateway, admin
- Владение данными не меняется: Platform — права/деньги, Jobs — leases и
  provider receipts, Core SEO — результаты; все logical DB остаются на
  центральном PostgreSQL. Email delivery остаётся только на главном узле.

## Причина

Текущий XMLStock rank path готовит каждый keyword через несколько отдельных
Jobs transactions, Platform grant, повторное чтение sealed chunk и полную
проверку Job/Run/Item/credential/route graph. Затем каждая подтверждённая
позиция обновляет горячую родительскую строку Job. Это даёт тысячи SQL calls
при небольшом числе одновременно идущих съёмов. Увеличение числа воркеров
без изменения этого пути перегрузит центральную БД.

## Решение

1. Новый Job один раз получает versioned run authorization от Platform после
   seal. BYOK не получает фиктивный Platform grant на каждый keyword. Деньги
   системного ключа резервируются ограниченными партиями перед отправкой, а
   каждый фактический provider call имеет отдельный idempotent usage receipt.
2. Один coordinator в Jobs выбирает небольшую пачку работы (начально 32–64
   keyword IDs) из indexed hot work table. `UPDATE ... FROM SELECT ... FOR
   UPDATE SKIP LOCKED ... RETURNING` выдаёт отдельный fenced lease каждой
   строке одной транзакцией. Выбор workspace/key/Job выполняется fair scheduler
   до SQL claim; огромная append-only история не сканируется ради следующего
   keyword. Неиспользованный candidate ID не является платным стартом.
3. Immutable run authorization, manifest hash, route/credential versions и
   project/actor scope проверяются один раз на выдаваемую пачку. Для каждого
   item остаются exact ID и content hash. `control_epoch` инвалидирует новые
   волны при отмене Job, отзыве узла или отключении подключения; уже
   отправленные HTTP не могут быть отменены задним числом.
4. Перед каждой bounded волной внешних HTTP coordinator одной короткой
   транзакцией фиксирует `MAY_HAVE_STARTED` для конкретных item/page attempts.
   Размер волны не превышает физический лимит ключа и свободную мощность узла.
   Центральный Redis атомарно выдаёт permits по physical-key/product и
   workspace fairness; Redis не владеет Job/result/secret state.
5. Воркер обрабатывает свою пачку в памяти без чтения PostgreSQL. Он
   отправляет page checkpoints/result receipts по 16–64 записи или в течение
   1–2 секунд; большой SERP/file payload передаётся через ограниченный
   immutable object. Core SEO идемпотентно записывает batch, Jobs подтверждает
   leases и инкрементирует progress один раз на batch. ACK следует только за
   центральным commit. Потеря неподтверждённого платного ответа допускает не
   более одного автоматического повтора с явной возможной двойной оплатой.
6. Пустые HTTP/worker lanes не опрашивают PostgreSQL раз в секунду. Новая
   работа сигнализируется через очередь, а indexed recovery sweep периодически
   подбирает истёкшие leases. Проекции админки читают bounded counters, а не
   всю историю attempts.
7. Главный Compose имеет собственный лимит HTTP (по умолчанию 64) и является
   fallback, когда доверенные remote nodes не имеют свободных slots. Каждый
   remote node имеет отдельный admin cap и обнаруженную здоровую мощность.
   Общего HTTP cap на всю fleet нет; физические provider-key/product caps
   остаются общими для всех узлов.

## Безопасность и совместимость

- Remote node открывает только исходящий проверяемый HTTPS к Worker Gateway
  через Caddy; тестовый адрес может быть HTTPS по IP при валидном IP SAN.
  Прямых DB/Redis/NATS credentials у узла нет.
- У узла отдельный revocable identity. BYOK secret передаётся только для
  назначенного call, не хранится в локальной БД, очереди, логах или файле.
- Старые Jobs завершаются через старый per-item grant path; новый путь
  включается только для новых операций за feature flag и protocol version.
- Нет общей транзакции между Jobs, Platform и SEO DB. Каждый шаг имеет
  deterministic idempotency key, durable receipt и reconciler.
- SMTP/email остаётся на главном сервере. Удалённый inspection node получает
  только scoped signed read URL на конкретный upload и возвращает bounded
  verdict; ClamAV обновляется на самом узле.

## Измеримые критерии

- Сравнить p95/p99 latency и SQL calls/transactions/WAL bytes на один keyword
  и одну provider page до/после. Текущий `pg_stat_statements` агрегирует роль,
  поэтому добавить безопасные per-Job counters без keyword/secret payload.
- На provider mock проверить 10/20/100 одновременных операций с разными
  physical keys, а также два workspace с одинаковым ключом.
- При `kill -9`, отключении сети и отзыве узла подтверждённые результаты не
  теряются, unacked items переназначаются, лишние платные повторы ограничены.
- При saturation PostgreSQL/SEO ingest scheduler уменьшает выдачу работы и
  распределяет оставшиеся slots справедливо. 100 Job могут все продвигаться
  по очереди, но 64 локальных HTTP slots не означают 100 одновременных GET.
- Фиксированный PostgreSQL не может масштабироваться линейно без предела:
  при достижении измеренного WAL/IOPS/CPU ceiling отдельно усиливается
  центральный data tier. Увеличение pool size само по себе не считается
  оптимизацией.

## Текущее состояние реализации

Пакетное чтение sealed manifest для подготовки и ingest, а также одно
fenced завершение до 16 rank-результатов с одним progress update реализованы.
Новый узел может зарегистрироваться и выполнять XMLStock rank poll через
HTTPS при явном opt-in; по умолчанию remote rank slots равны нулю. После
удалённого ambiguous lease допускается один same-page recovery. Текущий
rank agent запрашивает до 32 poll-задач одним HTTP-вызовом раз в пять секунд
на сервер; это устраняет умножение пустых опросов на число его HTTP-слотов,
но активные страницы пока заявляются в Jobs DB по одной.

Не реализованы и не должны считаться готовыми: run-level authorization и
пакетный Platform billing вместо per-item grant, set-based rank grant claim,
remote adapters Wordstat/AI/clustering/crawl/import/export/inspection,
authoritative worker assignment UI и нагрузочное доказательство 10/20/100.
