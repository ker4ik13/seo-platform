# Позиции, SERP и сбор данных

## 1. Tracking context

Позиция не существует без контекста. Контекст включает:

- search engine;
- country;
- provider-neutral platform region code/label;
- language;
- device;
- result depth;
- domain matching rule;
- safe search;

Один проект может иметь несколько активных контекстов. Контексты имеют человекочитаемые названия.

По ADR-2026-033 provider/credential принадлежат project connector binding, а
schedule/timezone — automation. Экран может показывать их effective projection
рядом с context, но они не входят в immutable tracking configuration.
Provider-specific region ID и форма provider request получаются adapter
mapping при создании immutable execution manifest и не записываются обратно
в tracking context.

## 2. Конфигурация отслеживания

Экран позволяет:

- создать контекст;
- выбрать запросы по view/group/tag/filter;
- включить/исключить SERP features;
- настроить domain matching;
- выбрать хранение raw SERP;
- сделать test run.

Расписание, provider/fallback и budget настраиваются связанными automation и
connector policy, а не дублируются в context.

Изменение контекста не переписывает историю. Любое изменение поисковой
конфигурации создаёт новую immutable configuration version; rename,
archive/restore меняют только revision логической сущности.

## 3. Запуск съёма позиций

Wizard:

1. проект и scope;
2. tracking contexts;
3. provider selection;
4. параметры;
5. предварительная оценка;
6. подтверждение.

Оценка содержит:

- число ключей;
- число запросов к provider;
- ожидаемое время;
- цена;
- источник оплаты;
- доступный баланс;
- fallback max cost;
- данные, которые будут сохранены.

### 3.1. Первый manual BYOK slice

По ADR-2026-034 первый execution slice использует Arsenkin `positions` только
после прохождения provider contract gate. До этого разрешены context,
assignment, binding, estimate и compatibility UI, но live submit выключен
provider/capability kill switch.

Первый scope ограничен Google Desktop/Mobile TOP-30, simple format, одним
context на provider task, chunk до 250 keywords и 1 000 keywords на command.
Яндекс, raw SERP, fallback и platform-paid route в этот slice не входят.
Country, language, safe search и domain rule запрещено молча отбрасывать:
непредставимый context получает compatibility blocker ещё в estimate.

`POST /rank-estimates` не вызывает provider и возвращает versioned scope hash,
configuration versions, credential freshness, provider limits, тарифную quota,
expiry и `executionAllowed`. `POST /rank-runs` требует актуальный estimate,
`ranking.run`, CSRF, idempotency key и authoritative execution grant.

### 3.2. Реализованный provider-free estimate

Первый реализованный estimate принимает ровно один `trackingContextId`,
требует `ranking.view`, browser session, CSRF и `Idempotency-Key`. Он остаётся
доступным в billing read-only и для архивного проекта: такие состояния
возвращаются как blockers будущего запуска, а не скрывают уже сохранённые
настройки.

Поток не создаёт Job/JobItem, не ставит сообщение в BullMQ, не расшифровывает
credential, не вызывает Arsenkin и не создаёт domain event:

1. Platform API загружает актуальные project/workspace snapshot, currency и
   проекцию наличия `ranking.run`; browser не задаёт tenant, provider,
   credential, домен, quota или lifecycle.
2. Jobs/integrations по internal HTTP запрашивает у SEO Data атомарный scope.
3. SEO Data в `RepeatableRead` читает context, последнюю immutable
   configuration и до 1 001 активного temporal assignment. Для допустимого
   scope рассчитывается domain-separated SHA-256; keyword ID/text наружу не
   возвращаются.
4. Jobs/integrations в собственной `RepeatableRead` транзакции читает только
   allowlisted binding/route/credential metadata и доказательство validation
   текущего material, рассчитывает blockers и записывает immutable
   пяти­минутный receipt.

Значение `1001` является bounded sentinel «не менее 1 001», а не точным
count; hash такого неполного множества имеет состояние `UNAVAILABLE`. Final
scope hash включает semantic scope, project domain/version и версии
binding/credential/validation/policy, но публичный ответ не раскрывает эти
идентификаторы.

До прохождения ADR-2026-034 каждый receipt содержит
`PROVIDER_CONTRACT_NOT_READY` и `PROVIDER_EXECUTION_DISABLED`;
`executionAllowed=false`. Provider limits, ожидаемая длительность,
entitlement и quota возвращают честный `NOT_AVAILABLE`, пока нет
авторитетного versioned источника. Для BYOK platform charge равен нулю,
нормализованная история предназначена для долгого хранения, raw SERP не
собирается.

После начала provider `set` неоднозначный timeout/crash/`5xx` переводит item в
`SUBMIT_OUTCOME_UNKNOWN`. Автоматический повтор submit запрещён, пока provider
не предоставляет доказуемую идемпотентность или способ восстановить task ID.
Пользователь может создать только осознанный новый запуск с предупреждением о
возможном повторном списании внешних лимитов.

### 3.3. Зафиксированные execution-контракты

До включения runtime реализованы exact contracts ручного запуска: public
command принимает только `estimateId`; Job projection использует конечную
матрицу status/stage; SEO Data boundary разделяет immutable manifest,
bounded chunks, normalized found/not-found ingest и terminal finalize.
Semantic active-run hash исключает run-specific IDs и timestamps, тогда как
integrity hashes покрывают полный versioned RFC 8785 JCS preimage. Runtime
manifest, Job orchestration и provider execution остаются следующими этапами.

## 4. Rank snapshot

Сохраняются:

- keyword ID;
- tracking context ID;
- capturedAt;
- provider;
- organic position;
- absolute/pixel position, если доступно;
- ranking URL;
- normalized ranking URL;
- title/snippet;
- result type;
- SERP features;
- top depth;
- found/not found;
- raw SERP reference;
- job ID;
- provider request ID;
- data quality flags.

`not found` отличается от ошибки сбора.

## 5. Доменное сопоставление

Режимы:

- exact host;
- include `www`;
- include subdomains;
- canonical domain;
- any project mirror;
- specific URL;
- URL prefix;
- regex для административной настройки.

Редиректы и URL normalization должны быть настраиваемыми. Сопоставление хранит использованное правило.

## 6. Экран мониторинга позиций

### Summary

- visibility;
- average position;
- TOP-1/3/5/10/20/30/50/100;
- gained/lost;
- entered/exited TOP;
- not found;
- tracked count;
- data completeness.

### Controls

- context;
- period;
- comparison period;
- group/tag/view;
- provider;
- annotations;
- competitor overlay.

### Графики

- visibility;
- average position;
- TOP distribution;
- gains/losses;
- competitor share;
- SERP feature share;
- estimated traffic with transparent formula.

### Таблица

- keyword;
- group;
- frequency;
- positions for selected dates;
- delta;
- ranking URL;
- target URL;
- cannibalization;
- features;
- freshness;
- data quality.

## 7. Детальная история запроса

- line chart positions;
- ranking URL timeline;
- title/snippet changes;
- SERP snapshots;
- competitor positions;
- annotations;
- target URL mismatch;
- raw result access by permission.

Пользователь может сравнить любые два snapshots.

## 8. Visibility

Формула является конфигурируемой и версионируемой:

- CTR curve;
- frequency type;
- frequency fallback;
- position cap;
- weighting by priority;
- treatment of not found;
- branded exclusions.

Отчёт показывает версию формулы. При изменении формулы исторические данные либо пересчитываются отдельным job, либо показываются по версии.

## 9. SERP snapshot

Сохраняются:

- ordered organic results;
- URL, host, title, snippet;
- result type;
- special blocks;
- ads presence;
- local/maps;
- featured snippet;
- people also ask;
- images/video/news/shopping;
- AI overview/AI answer, если provider законно предоставляет;
- collection context;
- provider and raw reference.

Сырые ответы:

- сжимаются;
- хранятся в object storage;
- имеют checksum;
- доступны ограниченному кругу ролей;
- удаляются по retention policy.

## 10. Сравнение SERP

- изменения TOP;
- новые/выпавшие домены;
- URL transitions;
- изменение special features;
- коэффициент стабильности;
- overlap между запросами;
- compare regions/devices/engines;
- compare dates.

## 11. Wordstat и частотности

### 11.1. Типы операций

- top requests;
- dynamics;
- regions;
- базовая частотность;
- точная фраза;
- фиксированная словоформа;
- вложенные запросы;
- левая/правая колонка, если источник предоставляет;
- batch refresh существующих запросов.

### 11.2. Frequency snapshot

- keyword;
- value;
- match/operator type;
- region;
- device, если применимо;
- period;
- observedAt;
- provider;
- job;
- source credential type;
- quality flags.

Значения разных операторов и регионов не перезаписывают друг друга.

### 11.3. Wordstat job wizard

- seed/source;
- region;
- devices;
- operation type;
- depth/page limit;
- negative words;
- min/max frequency;
- duplicate handling;
- target group;
- estimate;
- schedule.

## 12. Search suggestions

Источники:

- Google;
- Яндекс;
- YouTube;
- дополнительные provider connectors.

Параметры:

- locale;
- country;
- alphabet expansion;
- prefix/suffix;
- question modifiers;
- depth;
- dedup;
- target group.

Сбор должен соответствовать правилам источника и использовать разрешённый connector.

## 13. Сбор ключей конкурентов

Источники: Keys.so и последующие connectors.

Функции:

- organic keywords;
- paid keywords, если доступно;
- top pages;
- shared/unique keywords;
- domain comparison;
- historical data;
- filters by position/frequency/traffic;
- import proposal;
- mapping provider fields;
- estimate and quota.

Результат сначала показывается в staging preview; пользователь выбирает, что импортировать.

## 14. Проверка индексации

- single URL;
- sitemap;
- page list/filter;
- provider: Webmaster, Search Console URL Inspection, Arsenkin/XML provider;
- status;
- last crawl;
- canonical;
- robots;
- reason;
- checkedAt;
- provider.

Ограничения quota URL Inspection учитываются scheduler.

## 15. Универсальный экран «Сбор данных»

Карточки collectors:

- positions;
- SERP;
- Wordstat;
- suggestions;
- competitor keywords;
- indexing;
- clustering;
- analytics sync;
- crawl.

Каждая карточка показывает:

- доступные connectors;
- состояние credentials;
- последнюю задачу;
- стоимость;
- quick run;
- documentation.

## 16. Очередь и история

Колонки:

- job;
- project;
- type;
- source;
- scope;
- progress;
- stage;
- status;
- owner;
- created/start/end;
- cost estimate/actual;
- retries;
- actions.

Фильтры:

- workspace/project;
- type;
- provider;
- status;
- actor;
- schedule;
- period;
- paid/BYOK.

## 17. Job detail

- конфигурация;
- immutable input snapshot;
- этапы;
- progress;
- provider requests;
- rate limit;
- retry history;
- row/item errors;
- costs;
- reserved/charged/released amount;
- result links;
- logs safe for user;
- internal correlation IDs;
- cancel/retry/clone.

## 18. Data quality

Флаги:

- `COMPLETE`;
- `PARTIAL`;
- `CONTEXT_INCOMPLETE`;
- `PROVIDER_ERROR`;
- `PARSE_WARNING`;
- `STALE`;
- `FALLBACK_USED`;
- `MANUAL_IMPORT`;
- `OUTLIER`;
- `DUPLICATE_SNAPSHOT`.

UI не должен смешивать partial и complete data без обозначения.

## 19. Отказы и fallback

Fallback policy содержит:

- primary connector;
- ordered alternatives;
- retry policy primary;
- allowed error classes;
- max extra cost;
- max total cost;
- minimum balance;
- allowed credential types;
- notify conditions.

Fallback запрещён:

- если пользователь не дал согласие на системный paid key;
- если превышен budget;
- если контекст нельзя эквивалентно перенести;
- при authentication error пользовательского ключа без явной настройки;
- при юридическом ограничении региона.

Каждый fallback фиксируется в job и snapshot.

## 20. Частичные результаты

- Успешные элементы сохраняются.
- Ошибочные элементы имеют retryable/final classification.
- Повтор можно выполнить только для ошибок.
- Итоговый статус: `PARTIALLY_COMPLETED`.
- Стоимость рассчитывается по фактически принятым provider операциям.
- Пользователь может экспортировать error items.

## 21. Периоды и сравнения

- current vs previous equal period;
- custom date;
- selected snapshots;
- same weekday;
- before/after annotation;
- year-over-year.

Если snapshots отсутствуют на точных датах, UI показывает фактически использованные даты.

## 22. Состояния модуля

- tracking not configured;
- integration missing;
- credential expired;
- collecting;
- scheduled;
- queued;
- rate limited;
- partial;
- completed;
- cancelled;
- insufficient balance;
- quota exceeded;
- no snapshots in period;
- context changed;
- stale;
- archived project.

## 23. Производительность и хранение

- Текущие позиции читаются из materialized/current table.
- История — append-only partitioned snapshots.
- Dashboard агрегаты предварительно вычисляются.
- Raw SERP не читается для обычного отчёта.
- Retention raw и parsed данных настраивается отдельно.
- Удаление старых partitions выполняется обслуживающим job.
- Parsed/aggregate rank history платного workspace хранится без фиксированного
  продуктового срока и остаётся доступной в billing read-only.
- Raw SERP, provider payload и HTML имеют `expiresAt` из plan snapshot;
  их удаление не удаляет position/frequency aggregates и provenance metadata.
- Нулевой баланс блокирует новый сбор, но не чтение существующей истории.
