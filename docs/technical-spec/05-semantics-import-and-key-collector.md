# Семантическое ядро, импорт и совместимость с Key Collector

## 1. Назначение

Модуль является основным рабочим инструментом SEO-специалиста и должен поддерживать миллионы запросов, массовые операции, историю, совместную работу и обогащение внешними данными.

## 2. Основные сущности

- Keyword;
- KeywordVariant;
- Group;
- Cluster;
- Tag;
- LandingPage;
- KeywordLandingAssignment;
- CustomColumn;
- CustomFieldValue;
- MetricDefinition;
- MetricSnapshot;
- RankSnapshot;
- SavedView;
- FilterPreset;
- SemanticVersion;
- BulkOperation;
- Import;
- Export;
- Comment;
- AuditEvent.

## 3. Экран семантики

### 3.1. Области экрана

1. Заголовок и summary.
2. Дерево групп/кластеров.
3. Toolbar поиска и фильтров.
4. Chips активных фильтров.
5. Таблица.
6. Bulk bar.
7. Presence bar.
8. Панель деталей строки.
9. Нижний status bar.

### 3.2. Summary

- общее число запросов;
- число уникальных нормализованных запросов;
- кластеризовано;
- назначено URL;
- отслеживается;
- актуальная/устаревшая частотность;
- запросы с проблемами;
- изменения за период.

Каждая метрика кликабельна и применяет соответствующий фильтр.

## 4. Каноническая модель Keyword

Обязательные поля:

- `id`;
- `workspaceId`;
- `projectId`;
- `textOriginal`;
- `textNormalized`;
- `language`;
- `status`;
- `priority`;
- `isFavorite`;
- `isTracked`;
- `trackingContextIds`;
- `groupId`;
- `clusterId`;
- `targetPageId`;
- `intent`;
- `commerciality`;
- `geoDependency`;
- `wordCount`;
- `charCount`;
- `createdAt`;
- `createdBy`;
- `updatedAt`;
- `updatedBy`;
- `version`.

Опциональные поля:

- lemma;
- stem;
- question flag;
- branded flag;
- navigational flag;
- negative keyword flag;
- source;
- source external ID;
- notes;
- custom values.

## 5. Нормализация

Нормализатор является версионируемым и конфигурируемым.

Доступные операции:

- trim;
- Unicode normalization;
- схлопывание пробелов;
- приведение регистра;
- нормализация кавычек;
- удаление/сохранение операторов;
- замена `ё/е` по настройке;
- нормализация дефисов;
- удаление служебных символов;
- нормализация URL;
- выделение языка;
- лемматизация по поддерживаемому языку.

В Keyword сохраняются оригинальное и нормализованное значения. Изменение правил нормализации не должно молча переписывать существующие данные; оно выполняется отдельной версионируемой операцией с preview.

## 6. Дедупликация

Режимы:

- точное совпадение оригинала;
- совпадение normalized;
- без учёта операторов;
- без учёта порядка слов;
- по леммам;
- пользовательская формула.

Действия при дубле:

- пропустить;
- объединить значения по правилам;
- заменить существующую строку;
- создать вариант;
- отправить в отдельную группу конфликтов.

При объединении пользователь видит, какие поля будут сохранены, перезаписаны или конфликтуют.

## 7. Группы

- Иерархия без фиксированной глубины, но UI оптимизирован до 10 уровней.
- Группа имеет название, цвет, родителя, sort order, описание и владельца.
- Запрос может находиться в одной основной группе.
- Дополнительная классификация выполняется тегами.
- Перемещение большой группы — асинхронная операция.
- Удаление предлагает переместить запросы, оставить без группы или удалить.
- Количество запросов пересчитывается асинхронно и допускает временный `calculating`.

## 8. Кластеры

- Кластер может быть ручным или автоматически созданным.
- Содержит название, тип, confidence, метод, параметры, SERP snapshot IDs и target page.
- В группе может быть несколько кластеров.
- Запрос может находиться в одном активном кластере; история перемещений сохраняется.
- Поддерживаются merge, split, rename, lock и exclude from reclustering.
- Locked cluster не изменяется автоматической кластеризацией.

### 8.1. Методы кластеризации

- soft;
- middle;
- hard;
- порог общего числа URL;
- процент пересечения ТОП;
- выбранная глубина ТОП;
- поисковая система;
- регион;
- устройство;
- дата/свежесть SERP.

Результат кластеризации сначала создаётся как proposal:

- preview;
- статистика изменений;
- новые/удалённые кластеры;
- конфликты locked entities;
- стоимость;
- apply;
- reject.

## 9. Теги

- Несколько тегов на запрос.
- Теги имеют цвет, описание и scope workspace/project.
- Поддерживаются массовое добавление/удаление.
- Системные теги могут вычисляться автоматически, но пользовательские теги не удаляются автоматизацией.

## 10. Интенты и классификация

Базовые значения:

- informational;
- commercial investigation;
- transactional;
- navigational;
- local;
- mixed;
- unknown.

Поле хранит:

- значение;
- confidence;
- источник: manual/rule/AI/provider;
- дату;
- версию модели/правила.

Ручное значение имеет приоритет над автоматическим до явного снятия блокировки.

## 11. URL и карта страниц

- Запрос и кластер могут быть назначены существующей или планируемой странице.
- URL нормализуется относительно проекта.
- Хранится тип назначения: manual, imported, rule, AI, SERP.
- Хранится confidence и rationale.
- Поддерживаются primary и alternate pages.
- Конфликт нескольких страниц отмечается как potential cannibalization.
- Массовое назначение требует preview.

## 12. Колонки

### 12.1. Системные колонки

- запрос;
- группа;
- кластер;
- URL;
- теги;
- intent;
- приоритет;
- источник;
- дата добавления;
- частотности по контекстам;
- позиции по tracking contexts;
- ranking URL;
- SERP features;
- freshness;
- комментарии;
- ошибки.

### 12.2. Пользовательские колонки

Типы:

- text;
- long text;
- integer;
- decimal;
- boolean;
- date;
- datetime;
- select;
- multi-select;
- URL;
- formula;
- user;
- status.

Настройки:

- name;
- description;
- type;
- default;
- validation;
- allowed values;
- visibility;
- editable roles;
- aggregation;
- format;
- archived.

Изменение типа с потерей данных требует preview и подтверждения.

### 12.3. Формулы

Формулы являются read-only вычисляемыми колонками.

Поддерживается ограниченный expression language:

- арифметика;
- сравнения;
- условные выражения;
- строковые функции;
- date functions;
- обращение к системным и custom columns;
- `COALESCE`, `ROUND`, `IF`.

Формулы:

- валидируются до сохранения;
- имеют dependency graph;
- не допускают циклов;
- пересчитываются асинхронно при больших объёмах;
- имеют версию.

## 13. Фильтры

Операторы:

- equals/not equals;
- contains/not contains;
- starts/ends with;
- regex;
- greater/less/between;
- is empty/is not empty;
- in/not in;
- before/after;
- changed in period;
- freshness;
- has issue;
- belongs to subtree;
- full-text search.

Поддерживаются AND/OR groups и вложенность до разумного UI-лимита.

## 14. Сохранённые виды

View содержит:

- фильтры;
- sorting;
- columns;
- order;
- widths;
- pinned columns;
- density;
- grouping;
- color rules;
- selected tracking context.

Scope:

- private;
- project shared;
- workspace template;
- client published.

Изменение общего view требует разрешения; пользователь может сохранить копию.

## 15. Массовые операции

- перемещение;
- кластеризация;
- назначение URL;
- изменение тегов;
- изменение статуса/приоритета;
- включение отслеживания;
- сбор частотности;
- съём позиций;
- удаление;
- merge;
- очистка;
- формула/преобразование колонок;
- экспорт.

Каждая массовая операция:

- фиксирует filter snapshot/selection;
- показывает scope;
- рассчитывает влияние;
- при необходимости оценивает стоимость;
- создаёт job;
- ведёт row-level result;
- может быть отменена до необратимого этапа;
- создаёт semantic version и undo package.

## 16. Версионирование

Версия создаётся для:

- импорта;
- массового изменения;
- кластеризации;
- дедупликации;
- изменения URL;
- удаления;
- применения автоматического предложения.

Версия содержит:

- actor;
- source job;
- timestamp;
- summary;
- affected count;
- before/after diff;
- reversible flag;
- parent version.

Восстановление:

- сначала preview;
- не откатывает более новые несвязанные изменения без предупреждения;
- конфликтующие строки перечисляются;
- само восстановление создаёт новую версию.

## 17. Импорт: форматы

Поддерживаются:

- CSV;
- TSV;
- XLSX;
- XLS;
- ZIP с одним или несколькими поддерживаемыми файлами;
- вставка из clipboard;
- JSON через API;
- импорт из подключённого источника.

### 17.1. CSV/TSV

- UTF-8, UTF-8 BOM, Windows-1251 и определение encoding;
- delimiter auto-detect и ручной выбор;
- quote/escape;
- header/no header;
- переносы строк внутри quoted fields;
- preview первых строк;
- отчёт о повреждённых строках.

### 17.2. Excel

- выбор листов;
- пропуск скрытых листов по умолчанию;
- выбор строки заголовка;
- обработка merged cells по явному правилу;
- формулы импортируются как отображаемые значения с предупреждением;
- даты нормализуются с учётом locale;
- лимиты XLSX проверяются до обработки.

### 17.3. Key Collector

Поддерживается импорт CSV/TSV/XLSX, экспортированных из Key Collector.

Wizard должен распознавать и предлагать mapping:

- фраза;
- группа и иерархия групп;
- базовая/точная/фиксированная частотность;
- регионы;
- позиции;
- релевантная страница;
- поисковая система;
- дата проверки;
- теги/цветовые маркеры;
- KEI и пользовательские показатели;
- служебные колонки;
- пользовательские колонки.

Неизвестные колонки:

- можно пропустить;
- сопоставить;
- создать как custom column;
- сохранить в import raw payload.

Название и иерархия групп должны сохраняться. Если Key Collector экспортировал путь одной строкой, пользователь задаёт separator и видит preview дерева.

## 18. Import wizard

### Шаг 1. Источник

- upload;
- clipboard;
- integration;
- recent file.

### Шаг 2. Формат

- encoding;
- delimiter;
- sheet;
- header;
- locale;
- decimal separator;
- date format.

### Шаг 3. Mapping

- source column;
- target field;
- detected type;
- sample;
- required;
- transform.

Сопоставление можно сохранить как preset.

### Шаг 4. Scope

- target project;
- root group;
- tags;
- tracking contexts;
- source label.

### Шаг 5. Merge rules

- duplicate definition;
- create/update/skip;
- field-level conflict rules;
- empty value behavior;
- group conflict behavior;
- URL conflict behavior.

### Шаг 6. Cleaning

- whitespace;
- case;
- operators;
- stop words;
- invalid chars;
- languages;
- length;
- regex.

### Шаг 7. Validation preview

Показываются:

- total rows;
- valid;
- warnings;
- errors;
- duplicates in file;
- duplicates in project;
- new groups;
- new custom columns;
- estimated storage;
- estimated processing time.

### Шаг 8. Confirm

- итог;
- save preset;
- start;
- notify on completion.

## 19. Архитектура импорта

1. Клиент получает multipart upload session.
2. Части загружаются напрямую в S3-compatible storage.
3. Завершение upload сверяет состав parts и фактический размер объекта.
4. Worker потоково вычисляет SHA-256, сверяет переданный клиентом checksum,
   если он был указан, и выполняет антивирусную проверку.
5. Parser job читает потоково.
6. Строки попадают в staging tables.
7. Validation job создаёт summary.
8. Пользователь подтверждает mapping/merge, если не применён auto preset.
9. Commit job выполняет chunked merge.
10. Создаются semantic version, audit и результат.

Требования:

- файл не загружается целиком в память;
- поддерживается resume;
- клиентский checksum опционален, чтобы браузер не читал многогигабайтный
  файл целиком; серверный SHA-256 обязателен до статуса `ready`;
- commit идемпотентен;
- повтор job не создаёт дубли;
- progress отражает bytes, rows и stage;
- отмена до commit безопасна;
- отмена commit завершает текущую транзакцию chunk и прекращает следующие;
- импорт может завершиться частично;
- row-level errors экспортируются.

## 20. Стратегии merge

Для каждого поля:

- keep existing;
- overwrite;
- overwrite if import non-empty;
- fill only empty;
- max/min;
- newest by source date;
- merge arrays;
- create conflict.

Правило по умолчанию:

- textOriginal — сохранять существующее;
- group — импортированное, если пользователь подтвердил;
- tags — merge;
- metrics — создавать snapshot, не перезаписывать историю;
- URL — конфликт при различии manual assignment;
- custom column — выбранная пользователем стратегия.

## 21. Импорт метрик

Каждое импортированное значение частотности/позиции должно содержать контекст:

- metric type;
- source;
- observedAt;
- importedAt;
- search engine;
- region;
- language;
- device;
- operator/match type;
- raw value;
- import ID.

Если контекст отсутствует:

- значение не смешивается с нормальными snapshots;
- отмечается `CONTEXT_INCOMPLETE`;
- пользователь выбирает контекст в mapping;
- иначе значение доступно только как custom column.

## 22. Экспорт

Форматы:

- CSV;
- TSV;
- XLSX;
- JSON;
- NDJSON;
- Google Sheets-ready CSV;
- API stream.

Scope:

- selected rows;
- current page;
- current filter;
- group subtree;
- full core;
- change set/version.

Настройки:

- columns;
- headers and locale;
- encoding;
- delimiter;
- include source metadata;
- include history or current values;
- split by group/sheet;
- archive parts;
- password-protected archive.

Экспорт более порога всегда выполняется асинхронно. Download URL подписывается, ограничен по времени и журналируется.

## 23. Очистка и профессиональные инструменты

- stop-word lists;
- negative keyword lists;
- regex include/exclude;
- character filters;
- word/character count;
- frequency threshold;
- duplicate finder;
- similar phrase finder;
- order-independent comparison;
- case transformations;
- replace/regex replace;
- prefix/suffix;
- split by word or delimiter;
- phrase combine/generator;
- n-gram analysis;
- question extraction;
- geo modifier detection;
- brand detection;
- language detection;
- invalid/empty query cleanup.

Любой инструмент сначала показывает preview и количество затронутых строк.

## 24. Поиск

- exact phrase;
- substring;
- PostgreSQL full-text;
- trigram fuzzy;
- regex для ограниченного scope;
- поиск по URL, тегам, группе и custom fields.

Regex по миллионам строк выполняется асинхронно либо ограничивается предварительным фильтром.

## 25. Детальная карточка запроса

Tabs:

- overview;
- metrics;
- rankings;
- SERP;
- URL;
- changes;
- comments;
- raw/source.

Карточка показывает:

- все контексты;
- текущие и исторические значения;
- источник и freshness;
- ranking URL changes;
- SERP features;
- конкурентов;
- историю изменений;
- активных пользователей.

## 26. Состояния и ошибки модуля

- ядро пусто;
- импорт готовится;
- импорт требует mapping;
- импорт в процессе;
- импорт частично успешен;
- данные индексируются;
- custom formula пересчитывается;
- кластеризация proposal ready;
- bulk operation running;
- row conflict;
- source context missing;
- stale metrics;
- group counts recalculating;
- project archived;
- permission restricted;
- plan limit reached;
- storage limit reached.

## 27. Критерии производительности

- Открытие таблицы не должно загружать весь набор.
- p95 первого блока до 500 строк — не более 1,5 секунды при прогретом кеше.
- Фильтр по индексируемым полям — p95 не более 1 секунды.
- Scroll виртуализированной таблицы — целевые 60 fps на поддерживаемом устройстве.
- Inline update подтверждается UI не позднее 300 мс optimistic state; серверный p95 — до 500 мс.
- Импорт 5 ГБ принимается без HTTP timeout и продолжает обработку после закрытия вкладки.
- Bulk operation по миллионам строк не удерживает длинную HTTP-транзакцию.
