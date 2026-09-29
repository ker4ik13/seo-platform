# Эластичная производительность XMLStock на каждый физический ключ

Статус: черновик целевой доработки, не реализовано.

Связанное решение: [`ADR-2026-050`](../adr/ADR-2026-050-elastic-xmlstock-physical-key-capacity.md).

## 1. Цель

Каждый пользовательский XMLStock credential должен получать максимально
разрешённую для выбранного инструмента параллельность, когда общая мощность
платформы свободна. Несколько разных физических ключей должны обрабатываться
параллельно и не делить искусственный единый лимит одного ключа.

Если один и тот же XMLStock `USER ID + API key` добавлен несколькими
пользователями или workspace, он считается одним физическим ключом. Его
provider-лимит не умножается числом записей credential.

Доработка не создаёт OS-процесс, контейнер или отдельный deployable на каждую
операцию. Операция получает виртуальные HTTP-lanes из общего эластичного пула,
а число долгоживущих connector replicas масштабируется отдельно.

### Короткий ответ на продуктовые вопросы

- Реализовать отдельную производительность для каждого уникального ключа можно.
- Отдельный process на пользователя или операцию для этого не нужен.
- Один connector process обслуживает много операций и десятки асинхронных
  HTTP-lanes.
- Два разных Live-ключа по 10 потоков требуют минимум 20 global lanes.
- Два одинаковых ключа по 10 потоков должны совместно получить не более 10.
- Текущий сервер 8 CPU / 16 ГБ рассматривается для первого этапа на 24 global
  lanes, то есть для двух разных Live-ключей по 10 с небольшим резервом.
- Гарантия полного лимита десяткам и сотням ключей одновременно требует
  горизонтальных connector replicas и отдельного data-tier capacity plan.
- Точный денежный бюджет зависит от цен выбранного хостинга и SLA; ТЗ задаёт
  формулу и infrastructure tiers, а не выдуманную фиксированную цену.

## 2. Термины

- **Credential alias** — tenant-scoped запись подключения, видимая только
  владельцам workspace.
- **Физический ключ** — нормализованная пара XMLStock `USER ID + API key`.
- **Physical key ID** — непрозрачный HMAC-derived UUID физического ключа. Он
  используется только внутри Execution и Redis и не возвращается в API/UI.
- **Product** — отдельный XMLStock-инструмент: `WORDSTAT`,
  `YANDEX_SEARCH_API`, `YANDEX_LIVE`, `YANDEX_TURBO`, `GOOGLE_LIVE`.
- **Lane** — разрешение на один одновременно выполняющийся provider HTTP
  request. Lane не является Node.js process или CPU thread.
- **Credential concurrency** — пользовательский максимум lanes для credential
  alias и product.
- **Physical concurrency** — общий provider-safe максимум всех aliases одного
  физического ключа и product.
- **Global concurrency** — infrastructure-safe максимум XMLStock HTTP requests
  во всём execution contour.

## 3. Подтверждённые рекомендации XMLStock

Настройки считаются versioned provider policy, а не вечными константами. Перед
реализацией и при каждом изменении политики оператор повторно проверяет
официальную документацию XMLStock.

| Product | Рекомендация XMLStock | Начальный platform policy |
|---|---|---|
| Яндекс Wordstat | 10 потоков, задержка менее 1 секунды | `maxConcurrency=10` |
| Яндекс XML Proxy / Search API | до 50 потоков, задержка менее 1 секунды | `maxConcurrency=50` |
| Яндекс Live | до 10 потоков, задержка 1 секунда | `maxConcurrency=10`, `minDelayAfterResponseMs=1000` |
| Яндекс Turbo | provider не публикует обычное ограничение Live | `maxConcurrency=50` как начальный platform hard cap |
| Google XML Search | до 15 потоков, задержка 0,1–1 секунда | `maxConcurrency=15`, `minDelayAfterResponseMs=100` |

Скриншот общей настройки XML Proxy указывает до 50 потоков, тогда как
текстовая инструкция XMLStock для Key Collector рекомендует 10. Поэтому
`maxConcurrency=50` считается provisional hard maximum, default остаётся 10,
а повышение выше 10 требует fresh provider verification или письменного
подтверждения XMLStock.

Для ошибок Яндекс Live `20/110` применяется cooldown не менее 10 секунд. Для
Google `110` применяется cooldown 10 секунд. `Retry-After`, если он больше,
имеет приоритет. Повтор выполняется только для provider-confirmed retryable
outcome и не обходит idempotency/submit-ambiguity guard.

Источники:

- [Яндекс Wordstat — настройки программ](https://xmlstock.com/?do=help-wordstat-settings);
- [Яндекс XML Proxy — настройки программ](https://xmlstock.com/?do=help-yaxml-settings);
- [Яндекс Live — общая информация](https://xmlstock.com/?do=help-yalive-about);
- [XMLStock — тарифы и ограничения](https://xmlstock.com/?do=help-tariffs).

Скриншоты владельца продукта остаются входным evidence для Wordstat, XML
Proxy, Live и Google до появления эквивалентного машиночитаемого provider
contract.

## 4. Продуктовые правила

1. Пользователь с правом настройки интеграций может задать число потоков
   отдельно для каждого XMLStock product.
2. Значение ограничено диапазоном `1..providerPolicy.maxConcurrency`.
3. UI показывает рекомендуемое значение, максимум provider policy и текущий
   platform hard cap.
4. Если работает одна операция одного credential, она может использовать весь
   заданный пользователем concurrency.
5. Несколько операций одного credential делят его concurrency справедливо;
   каждая операция не получает отдельный полный provider-лимит.
6. Два разных физических ключа получают независимые provider buckets и могут
   одновременно использовать свои лимиты, пока хватает global concurrency.
7. Два одинаковых физических ключа, добавленные в разных workspace, делят один
   physical bucket. UI не сообщает пользователям о существовании другого
   alias и не раскрывает cross-tenant metadata.
8. При исчерпании global concurrency операция остаётся в durable queue. Она не
   считается ошибочной и получает safe status `WAITING_PROVIDER_CAPACITY`.
9. Пользовательская настройка является верхним пределом, а не гарантией
   мгновенной мощности при глобальной перегрузке. Гарантированная мощность
   требует отдельного тарифного reservation/SLA.
10. Новое значение применяется только к provider calls, ещё не начавшим HTTP.
    Уже выполняющиеся requests не прерываются.

## 5. UI настроек

В карточке XMLStock credential появляется раздел «Параллельность»:

- Яндекс Live: `1..10`, default `10`;
- Яндекс Turbo: `1..platformTurboHardCap`, initial default `20`;
- Яндекс Search API: `1..50`, default `10`;
- Google Live: `1..15`, default `15`;
- Wordstat/частотность: `1..10`, default `10`;
- Wordstat expansion использует тот же physical `WORDSTAT` bucket, но может
  иметь меньший alias cap.

Каждое поле показывает:

- «Поток» означает один одновременный HTTP-запрос, а не процесс;
- provider maximum;
- platform maximum;
- ожидаемую скорость на основе p50/p95 latency последних успешных requests;
- предупреждение, что несколько операций того же физического ключа делят
  общий лимит;
- безопасное degraded-состояние при отсутствии fresh provider policy.

Сохранение использует CAS-version и permission `integration.manage`.
Неизвестные поля, значения вне диапазона и stale version отклоняются.

## 6. Идентичность одинаковых ключей

Текущий BYOK fallback использует credential-row UUID как Redis quota scope.
Поэтому одинаковый секрет в двух workspace ошибочно получает два независимых
buckets. Целевая версия устраняет это без глобального plaintext registry.

При создании или штатной ротации BYOK credential management-role вычисляет:

```text
HMAC-SHA256(
  oldest-retained-fingerprint-key,
  "xmlstock-physical-key@1\0" + normalizedUserId + "\0" + apiKey
)
```

Digest преобразуется в непрозрачный UUID и сохраняется только внутри
зашифрованного credential payload как `rateLimitScopeId`. Два одинаковых
секрета получают одинаковый scope ID независимо от workspace, actor, label и
idempotency key. Request fingerprint остаётся отдельным и по-прежнему включает
tenant/actor/idempotency context.

Обязательные свойства:

- raw digest, API key и USER ID не логируются и не попадают в Redis;
- Redis видит только opaque UUID;
- публичные DTO не содержат physical key ID;
- equality одного физического ключа не observable между tenant’ами;
- fingerprint key rotation сохраняет старую покрывающую key version до
  controlled rewrap всех credential payloads;
- credential revoke не удаляет общий bucket немедленно: короткий TTL сохраняет
  fail-safe ограничения для уже выполняющихся calls.

Если alias A настроен на 5 потоков, alias B на 10, а секрет одинаковый:

- calls alias A не превышают 5 одновременно;
- calls alias B не превышают 10 одновременно;
- суммарно A+B не превышают physical provider policy, например 10 для Live.

## 7. Целевая модель capacity

Каждый provider call должен получить три permits:

```text
operation permit
  ∩ credential-alias permit
  ∩ physical-key/product permit
  ∩ global/product infrastructure permit
```

Фактический concurrency равен минимуму доступных уровней. Redis Lua-команда
выдаёт permits атомарно и возвращает точный bounded retry delay. Частичная
выдача запрещена.

Ключи Redis:

```text
xmlstock:global:<product>
xmlstock:physical:<physicalKeyId>:<product>
xmlstock:alias:<credentialId>:<product>
xmlstock:operation:<jobId>:<product>
```

Redis остаётся fail-closed capacity coordinator, но не источником Job state.
После Redis restart новые permits блокируются на recovery fence не короче
максимального старого permit lease. Затем durable executions восстанавливаются
из PostgreSQL и повторно получают permits. Это не позволяет забытым in-flight
HTTP requests пересечься с новым полным bucket. Начатый ambiguous submit не
повторяется.

## 8. Scheduler и fairness

Connector dispatcher выбирает работу иерархически:

1. recovery уже оплаченного/принятого provider результата;
2. pending poll асинхронной provider task;
3. physical key round-robin;
4. workspace round-robin внутри physical key;
5. Job round-robin внутри workspace;
6. очередной keyword/page.

Один большой Job не может занимать все global lanes, если есть готовая работа
других physical keys. Один пользователь не получает больше lanes только потому,
что разбил съём на несколько операций.

Для одного physical key scheduler использует weighted fair share aliases, но
никогда не превышает physical cap. Weight может зависеть только от явного
тарифа/SLA, а не от количества созданных Jobs.

## 9. Worker topology

### 9.1. Что не создаётся

На одну операцию не создаются:

- новый Docker container;
- новый Node.js process;
- новый Prisma pool;
- отдельный Redis instance;
- отдельная provider queue.

Такой дизайн при 100 операциях дал бы примерно 100 Nest/Prisma processes,
ориентировочно 10–25 ГБ базовой RAM и 200–500 потенциальных DB connections,
что уже превышает возможности текущего single node.

### 9.2. Что создаётся

Операция создаёт PostgreSQL Job/Items/executions и получает виртуальные lanes
в общих connector processes. Один долгоживущий connector process обслуживает
много пользователей, ключей и операций асинхронно.

### 9.3. Горизонтальное масштабирование

Для роста connector-role выделяется в independently scalable deployment
profile того же `backend-execution` artifact. Исходный сервис и data ownership
не меняются. Replica получает только connector DB role, Redis ACL, execution
KEK и необходимые internal tokens.

Рекомендуемый предел одного выделенного connector replica profile определяется
load test; начальная гипотеза — 24–40 HTTP lanes на replica, а single-node
phase 1 ниже использует 24 lanes суммарно через три текущих process. Число
процессов/replicas рассчитывается как:

```text
ceil(requiredGlobalLanes / verifiedLanesPerProcess)
```

Dokploy replica count изменяется заранее или автоматикой по queue lag,
provider-wait latency, CPU, RSS и DB persistence lag. Масштабирование по числу
Jobs без этих метрик запрещено.

Оценка количества процессов:

| Этап | Connector processes | Lanes | Process на операцию |
|---|---:|---:|---:|
| Текущий production | 3 | 12 | 0 |
| Single-node phase 1 | 3 | 24 | 0 |
| Пример 100 global lanes при verified 32/process | 4 | 100–128 | 0 |
| Буквальные 1 000 lanes при verified 32/process | 32 | 1 000–1 024 | 0 |

Большие process count распределяются между connector nodes; 32 процесса в
одном backend-execution container не допускаются.

## 10. Расчёт требуемой мощности

Для одного workload:

```text
providerRequests = keywords × pagesPerKeyword
requiredLanes = ceil(providerRequests × averageLatencySeconds / targetSeconds)
```

Для нескольких одновременных workloads requests суммируются.

Пример: 100 пользователей, у каждого 5 000 ключей, Яндекс Live strict Top-30:

```text
100 × 5 000 × 3 = 1 500 000 provider requests
```

При среднем ответе 5 секунд:

| Целевое время завершения | Требуемый global concurrency |
|---:|---:|
| 24 часа | 87 lanes |
| 12 часов | 174 lanes |
| 6 часов | 348 lanes |

Буквальная гарантия «каждый из 100 ключей всегда получает 10 потоков» требует
1 000 одновременных lanes. Это не равно требованию закончить суточный workload
за 24 часа и не должно включаться без отдельного оплачиваемого SLA.

## 11. Capacity текущего сервера 8 CPU / 16 ГБ

Эксплуатационный baseline 23 сентября 2026 года:

- `backend-execution` наблюдался на уровне 1–2,6 ГБ RSS;
- PostgreSQL достигал примерно 6,7 CPU cores во время тяжёлого rank workload;
- Redis Jobs ранее получил `OOM command not allowed` при собственном
  `maxmemory=512 MB`, хотя RAM хоста ещё была доступна;
- один rank Top-30 на 5 000 ключей создаёт 15 000 provider calls, 5 000 rank
  snapshots и до 150 000 SERP rows.

До отдельного load test безопасный phase-1 target:

```text
CONNECTOR_WORKER_PROCESSES=3
RANK_CONNECTOR_CONCURRENCY=8
global rank lanes=24
```

При этом normal Yandex Live physical cap остаётся 10. Два разных Live-ключа
могут получить по 10 lanes одновременно; ещё 4 lanes остаются другим product
или recovery work.

Текущий `JOBS_CONNECTOR_DATABASE_POOL_MAX=12` допускает local concurrency 8:

```text
validation 1 + rank 8 + frequency 1 + research 1 + reserve 1 = 12
```

Перед phase 1 обязательно:

1. увеличить Redis Jobs `maxmemory` минимум до 1 ГБ и container limit минимум
   до 1,5 ГБ либо доказать load test, что меньшего значения достаточно;
2. подтвердить отсутствие Redis OOM/noeviction reject;
3. измерить PostgreSQL CPU, active connections, lock waits, WAL, checkpoint и
   result persistence lag;
4. ограничить normal Live physical bucket десятью потоками;
5. исправить cooldown `20/110` по provider policy;
6. провести bounded paid canary не более согласованного бюджета.

Повышение выше 24 global lanes на текущем single node запрещено без
репрезентативного теста. Ожидание HTTP почти не потребляет CPU, но увеличение
скорости ответов создаёт пропорциональный burst вставок и индексации в
PostgreSQL.

## 12. Стоимость инфраструктуры

Для BYOK provider requests оплачивает владелец ключа. Платформа несёт расходы
на compute, RAM, PostgreSQL, Redis, traffic, storage, backup и observability.

Точная сумма в рублях не фиксируется в ТЗ без выбранного hosting price book.
Стоимость рассчитывается формулой:

```text
monthlyInfrastructureCost =
  connectorReplicaCount × connectorNodePrice
  + PostgreSQLPrice
  + RedisPrice
  + storageAndBackupPrice
  + outboundTrafficPrice
  + monitoringPrice
```

Оценочные deployment tiers:

| Требование | Инфраструктура | Дополнительный monthly compute |
|---|---|---|
| 2 уникальных Live-ключа × 10 lanes | текущий 8 CPU / 16 ГБ после phase-1 hardening | новый сервер не обязателен |
| 10 ключей × 10 гарантированных lanes | отдельные connector replicas и dedicated PostgreSQL load test | минимум один дополнительный execution node; DB определяется тестом |
| 100 ключей × 10 гарантированных lanes | около 1 000 lanes, отдельный connector fleet, dedicated Redis и PostgreSQL | ориентировочно 8–10 connector capacity units плюс отдельный data tier |

`Connector capacity unit` — измеренный на staging узел/replica profile, а не
маркетинговая единица. Начальная гипотеза для отдельного 8 CPU / 16 ГБ
connector node — 96–128 I/O lanes, но она не является production обещанием до
load test с реальными XMLStock response sizes и persistence traffic.

Стоимость одной операции дополнительно зависит от retention. Для 5 000
ключей Top-30 сохраняется до 150 000 SERP rows; фактические bytes/row и
index/WAL multiplier должны измеряться на production-like PostgreSQL, а не
задаваться оценкой из памяти.

### 12.1. Оценка стоимости разработки

Предварительная инженерная оценка первого production increment:

| Блок | Оценка |
|---|---:|
| Versioned provider policies, contracts и migration | 3–5 инженерных дней |
| Physical-key HMAC, rewrap и rotation safety | 4–6 дней |
| Multi-level Redis permits и fair scheduler | 7–10 дней |
| API и UI настройки потоков | 4–6 дней |
| Метрики, admin diagnostics и alerts | 4–6 дней |
| Load tests, paid canary, rollout и rollback rehearsal | 5–8 дней |
| Итого | ориентировочно 27–41 инженерный день |

Оценка не включает отдельный autoscaling controller, перенос PostgreSQL или
создание multi-node production contour. Эти работы оцениваются после phase-1
load report. Параллельная работа сокращает календарный срок, но не объём review,
security и эксплуатационной проверки.

## 13. Data model и API

Execution-owned новая таблица:

```text
integration_credential_product_capacities
- credential_id
- workspace_id
- provider
- product
- requested_concurrency
- version
- updated_by
- updated_at
```

Primary key: `(workspace_id, credential_id, product)`. FK остаётся
tenant-safe. Physical key ID находится в encrypted credential payload и не
требует глобальной plaintext/equality table.

Public API:

- `GET /api/v1/workspaces/:workspaceId/integrations/credentials/:id/capacity`;
- `PUT /api/v1/workspaces/:workspaceId/integrations/credentials/:id/capacity`
  с `If-Match`/version;
- safe response содержит products, requested concurrency, provider maximum,
  platform maximum и version;
- safe response не содержит physical key ID, другие aliases, global active
  count или чужую нагрузку.

Private immutable execution snapshot добавляет:

- capacity policy version;
- requested alias concurrency;
- provider product;
- global policy generation.

Изменение настройки не переписывает старые Jobs и provider evidence.

## 14. Безопасность

- API key, USER ID и plaintext fingerprint запрещены в DB metadata, Redis,
  queue payload, logs, traces, events и metrics labels.
- Metrics используют product и bounded opaque hash prefix только внутри admin
  contour; пользовательский UI не получает его.
- Duplicate physical key не создаёт observable conflict между tenants.
- Global equality HMAC не используется для авторизации или tenant lookup.
- Connector replicas получают execution-only KEK role; management endpoints и
  fingerprint calculation остаются в management-role.
- Redis failure не разрешает provider HTTP без permit.
- Любое повышение provider maximum требует policy generation и audit.

## 15. Наблюдаемость

Обязательные metrics:

- global active/waiting lanes по product;
- active/waiting permits по opaque physical key;
- queue lag p50/p95/p99;
- provider latency p50/p95/p99;
- requests/sec и retry/error code;
- cooldown/penalty level;
- fairness wait по workspace/Job без credential label;
- result persistence lag;
- PostgreSQL CPU/connections/locks/WAL/checkpoints;
- Redis used memory, rejected writes и Lua latency;
- connector RSS/event-loop lag/open sockets.

Admin показывает capacity, но не raw credentials. Alert создаётся при:

- provider error `20/110/429/503` storm;
- Redis memory > 70/85%;
- persistence lag > 60/300 секунд;
- PostgreSQL CPU > 70% 10 минут;
- fairness starvation > 2 × прогнозного окна;
- physical bucket active count выше policy maximum.

## 16. Rollout

1. Добавить provider capacity profiles и тесты документационных границ.
2. Начать вычислять physical scope ID для новых BYOK credentials.
3. Controlled management rewrap добавляет scope ID существующим credentials;
   старый credential-ID bucket сохраняется до drain активных executions.
4. Включить shadow accounting: новый limiter считает permits, но не влияет на
   HTTP; сравнить с текущим limiter.
5. Включить physical buckets для одного тестового workspace.
6. Добавить UI настройки concurrency.
7. Включить global 24-lane phase и провести paid canary.
8. Выделить connector-role в масштабируемый profile только после метрик.
9. Повышать global capacity ступенями `24 → 40 → 80`, с rollback threshold на
   каждом этапе.

Rollback переключает dispatcher на прежний static global pool. Durable Jobs,
snapshots и credential ciphertext не удаляются. Новые capacity rows остаются
неактивной конфигурацией для повторного rollout.

## 17. Критерии приёмки

### Функциональные

1. Один Live credential с настройкой 10 достигает 10 одновременных calls при
   достаточном workload и global capacity.
2. Два разных Live credentials с настройкой 10 одновременно достигают 20
   calls при global capacity не менее 20.
3. Два одинаковых credentials в разных workspace суммарно никогда не
   превышают physical cap 10.
4. Alias с настройкой 5 не превышает 5, даже если другой alias того же ключа
   настроен на 10.
5. Wordstat, Search API, Live, Turbo и Google используют независимые product
   buckets одного physical key.
6. Две операции одного alias делят его лимит без starvation.
7. Изменение настройки применяется к новым calls без остановки выполняющихся.

### Надёжность и безопасность

1. Kill одного connector process не создаёт повторный платный submit.
2. Redis restart не разрешает новый HTTP до завершения recovery fence старых
   permit leases.
3. В logs/events/metrics/queue отсутствуют key, USER ID и reversible
   fingerprint.
4. Cross-tenant API не позволяет узнать, что ключ совпадает.
5. Error `20/110` создаёт provider-compliant cooldown и bounded retry.

### Нагрузочные

1. Матрица `2 physical keys × 10 lanes` проходит 30 минут без starvation,
   Redis OOM и persistence lag > 60 секунд.
2. Матрица `10 keys × requested 10 × global 24` сохраняет fair share и
   bounded memory.
3. 100 synthetic keys проверяются без provider HTTP в transport simulator;
   measured throughput совпадает с capacity formula ±10%.
4. Production-like 5 000-key Top-30 canary выполняется только в явно
   согласованном платном бюджете.
5. PostgreSQL p95 claim/persist, WAL и index growth приложены к release report.

## 18. Не входит в первый increment

- отдельный контейнер/процесс на каждую пользовательскую операцию;
- обещание 10 lanes каждому ключу при любой глобальной нагрузке без SLA;
- Kubernetes только ради этой функции;
- раскрытие пользователю чужой активности того же физического ключа;
- автоматическое повышение provider maximum по пользовательскому вводу;
- перенос provider state из PostgreSQL в Redis;
- hard delete исторических Jobs или snapshots ради освобождения capacity.
