# Позиции, SERP и сбор данных

## 1. Tracking context

Позиция не существует без контекста. Контекст включает:

- search engine;
- country;
- region/provider region ID;
- language;
- device;
- result depth;
- domain matching rule;
- safe search;

Один проект может иметь несколько активных контекстов. Контексты имеют человекочитаемые названия.

По ADR-2026-033 provider/credential принадлежат project connector binding, а
schedule/timezone — automation. Экран может показывать их effective projection
рядом с context, но они не входят в immutable tracking configuration.

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
