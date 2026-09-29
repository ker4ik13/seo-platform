# ADR-2026-050: эластичные XMLStock lanes на физический ключ

- Статус: предлагается
- Дата: 24 сентября 2026 года
- Затронутые области: Execution connectors, credential vault, Redis Jobs,
  rank/frequency/keyword-research scheduling, integration settings, Dokploy
- Изменение API/БД: versioned capacity settings; encrypted physical key scope;
  публичные секреты и data ownership не меняются

## Контекст

Текущий production использует фиксированный общий rank pool:
`CONNECTOR_WORKER_PROCESSES=3 × RANK_CONNECTOR_CONCURRENCY=4 = 12 lanes`.
Разные BYOK XMLStock credentials имеют независимые credential-row Redis
buckets, но одинаковый физический secret в двух workspace ошибочно считается
двумя ключами. Добавление пользователей не увеличивает global throughput.

Владелец продукта требует:

- настраивать число потоков XMLStock по credential/product;
- позволять одному уникальному ключу использовать provider maximum;
- позволять нескольким уникальным ключам работать параллельно;
- не умножать provider limit, если одинаковый ключ добавлен несколько раз;
- оценить вариант отдельного worker на операцию и стоимость масштаба.

## Решение

1. Не создавать process/container на каждую операцию.
2. Операции получают виртуальные lanes из общего connector pool.
3. BYOK credential получает deterministic HMAC-derived physical scope ID внутри
   encrypted payload. Одинаковые `USER ID + API key` делят Redis bucket даже
   между workspace, но equality не раскрывается наружу.
4. Concurrency настраивается по credential alias и product, а physical cap
   задаётся versioned platform provider policy.
5. Каждый HTTP request атомарно получает operation, alias, physical и global
   permits. Redis fail-closed; PostgreSQL остаётся источником lifecycle.
6. Scheduler применяет physical-key → workspace → Job fairness и отдаёт
   приоритет recovery/poll перед новым submit.
7. Connector-role может быть выделена в независимо масштабируемый profile того
   же artifact. Отдельный source service или новый data owner не создаётся.
8. Single-node rollout начинается с global 24 lanes только после Redis/DB
   hardening и load test.

## Почему не worker на операцию

Один Node/Nest/Prisma process на Job создаёт линейный рост базовой памяти,
DB connections, startup time и secret surface. При 100 операциях это примерно
100 процессов, 10–25 ГБ базовой RAM и 200–500 потенциальных DB connections до
учёта provider response buffers. На 8 CPU / 16 ГБ схема неработоспособна.

Async connector process способен безопасно обслуживать десятки HTTP requests;
масштабировать нужно измеренные replicas/lanes, а не количество пользовательских
Jobs.

## Последствия

Положительные:

- разные physical keys используют параллельную provider capacity;
- одинаковый ключ не обходит provider limit через несколько tenants;
- одна операция получает весь alias cap при свободной платформе;
- число процессов зависит от глобальной нагрузки, а не числа Jobs;
- сохраняются durable claims, idempotency, scoped KEK и current data ownership.

Компромиссы:

- «максимум каждому всегда» возможен только с достаточным global capacity или
  отдельным SLA/autoscaling;
- потребуется controlled rewrap старых BYOK credentials;
- Redis становится multi-level permit coordinator и требует отдельного load
  proof;
- рост connector throughput переносит bottleneck в PostgreSQL persistence;
- выделение connector profile частично отступает от минимальной topology
  ADR-2026-041 и допускается только после метрик.

## Альтернативы

### Process/container на Job

Отклонено: линейные RAM/DB/startup/secrets, плохая утилизация при ожидании HTTP,
невозможность гарантировать capacity single-node.

### Только увеличить глобальный `RANK_CONNECTOR_CONCURRENCY`

Отклонено как полное решение: разные ключи ускорятся, но одинаковые ключи
получат умноженный quota bucket; нет пользовательской настройки и SLA/fairness.

### Один фиксированный pool на workspace

Отклонено: один physical key может существовать в нескольких workspace, а
provider ограничивает ключ/account, не tenant платформы.

### Глобальная plaintext-таблица ключей

Отклонено: расширяет blast radius и создаёт cross-tenant equality registry.
Достаточен opaque HMAC scope внутри ciphertext.

## Миграция и rollback

Rollout следует разделу 16 технического ТЗ. До полного rewrap старые executions
используют legacy credential-row scope; смешивать legacy/new buckets одного
активного physical key без drain запрещено. Rollback отключает multi-level
permits и возвращает static global pool, не изменяя Jobs и snapshots.

## Проверка решения

ADR принимается только после:

- security review HMAC equality и rotation;
- PostgreSQL/Redis load test;
- proof `2 distinct keys × 10 lanes`;
- proof `2 equal keys × combined 10 lanes`;
- resource report для 8 CPU / 16 ГБ;
- review стоимости горизонтального tier;
- bounded paid XMLStock canary с явным бюджетом.
