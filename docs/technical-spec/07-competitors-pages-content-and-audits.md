# Конкуренты, страницы, контент и технические проверки

## 1. Конкуренты

### 1.1. Типы конкурентов

- domain competitor;
- subdomain;
- marketplace/aggregator;
- SERP-discovered;
- business competitor;
- keyword-level competitor.

Конкурент может быть глобальным для проекта или относиться к группе/региону.

### 1.2. Добавление

Источники:

- вручную;
- предложения по SERP overlap;
- Keys.so;
- импорт;
- шаблон проекта.

Поля:

- domain;
- display name;
- type;
- regions;
- groups;
- tags;
- priority;
- tracking enabled;
- notes.

### 1.3. Экран обзора

- visibility share;
- средняя позиция;
- число общих запросов;
- unique keywords;
- keyword gap;
- top pages;
- gained/lost;
- SERP overlap;
- динамика;
- последняя актуализация.

### 1.4. Пересечение семантики

Сегменты:

- есть у проекта и конкурента;
- только у проекта;
- только у конкурента;
- проект ниже конкурента;
- проект выше конкурента;
- отсутствует целевая страница;
- конкурент имеет другой intent/page type.

Результаты можно сохранить как view или импортировать proposal.

### 1.5. Страницы конкурентов

- URL;
- estimated traffic;
- ranking keywords;
- top positions;
- page type;
- discoveredAt;
- lastSeenAt;
- title/snippet;
- changes.

Система не должна утверждать точный трафик, если он рассчитан моделью.

### 1.6. Мониторинг изменений

- новые ключи;
- выпавшие ключи;
- новый URL;
- изменение title/snippet;
- рост/падение visibility;
- появление SERP feature;
- смена ranking page.

Изменения содержимого и технических полей URL отслеживаются Radar-модулем из
раздела 10.4. Мониторинг SERP и Radar не смешиваются в один тип snapshot.

### 1.7. Проектная вкладка Keys.so

Отдельная вкладка проекта показывает результат последнего и историю
асинхронных Keys.so запусков: TOP-метрики домена, органические запросы и
конкурентов. Это staging/read workflow, а не автоматическое изменение
канонической семантики. Пользователь отмечает нужные строки, после чего либо
импортирует их в папку, либо открывает Wordstat-парсинг XMLStock/Arsenkin с уже
заполненными seed-фразами и Россией (`225`) как начальным регионом. Права разделены на `competitor.view`,
`collector.run`, `competitor.manage` и `collector.cancel`.

## 2. Карта страниц проекта

### 2.1. Сущность Page

- canonical URL;
- original URLs/aliases;
- type;
- status;
- indexability;
- HTTP status;
- canonical target;
- robots;
- title;
- description;
- H1;
- language;
- template;
- content status;
- owner;
- priority;
- publishedAt;
- crawledAt;
- analytics metrics;
- linked clusters;
- tasks;
- notes.

Тип страницы:

- existing;
- planned;
- redirected;
- deleted;
- external;
- unknown.

### 2.2. Источники страниц

- crawl;
- sitemap;
- Search Console;
- Webmaster;
- analytics;
- manual;
- import;
- CMS integration.

Источники объединяются по normalized canonical URL.

### 2.3. Представления

- table;
- tree by path;
- tree by site structure;
- board by content status;
- cluster map;
- issues.

### 2.4. Связь с семантикой

- primary cluster;
- secondary clusters;
- individual keyword assignments;
- target URL;
- observed ranking URLs;
- mismatch;
- cannibalization.

### 2.5. Автоматическая карта первой производственной версии

Успешные строки проектного обхода при включённом `savePageMap` объединяются с
`Page` по нормализованному URL и автоматически появляются в карте. Таблица и
дерево пути читают только `includedInMap`; ручное добавление уже встречавшегося
в отключённом от карты crawl snapshot URL повышает скрытую backing-страницу,
а не создаёт дубль. List projection возвращает компактный последний snapshot,
а полный bounded список meta tags загружается только при открытии инспектора.
Инспектор показывает HTTP, индексируемость, Title/Description/H1, canonical,
robots, sitemap, response time, размер, content type, word/image/alt metrics,
structured data, семантические назначения, источники и даты. Структура содержит
до 5 000 активных URL проекта и не требует отдельного deployable-сервиса.
Desktop-карта использует всю высоту рабочей поверхности: дерево, таблица и
инспектор образуют одну бесшовную сетку без внешних карточных отступов и имеют
собственные ограниченные области прокрутки. На узком экране колонки безопасно
складываются в вертикальный поток. Текстовый поиск и навигация по структуре
независимы: выбранный узел передаётся отдельным bounded `pathPrefix` и включает
как URL самого раздела, так и потомков. Заголовок таблицы остаётся sticky;
ширина дерева, инспектора и колонок меняется pointer/keyboard resizer-ами и
локально сохраняется для проекта. Узлы с потомками ведут себя как папки:
имеют отдельную доступную кнопку раскрытия, могут сворачиваться независимо и
запоминают bounded project-scoped browser state; глубокие ветки создаются в DOM
только после раскрытия. Инспектор раскрывает tenant-scoped crawl
issue evidence с severity, кодом, датой и bounded details, а не только счётчик.
Проблемы запрашиваются по проверенному `pageId`, поэтому инспектор не зависит от
общего bounded списка проблем проекта.

### 2.6. Утверждённая доработка карты и связи с семантикой

Карта имеет таблицу и дерево-схему URL-путей. Переключение вида сохраняет
выбранную страницу; схема раскрывается иконками без кнопки «Ещё», соседние страницы располагаются компактной сеткой. Ширина, набор колонок и
раскрытые папки, фильтры, выбранный раздел, срез, дата и сортировка сохраняются в браузере отдельно для authenticated пользователя и проекта. Заголовки используют общий компонент с семантикой; сервер сортирует всю выборку до keyset pagination, закрепляет корень раздела первым и помещает неизвестные значения в конец. День `latest` фиксируется cursor-ом при сортировке средней позиции. Structure manifest не повторяется при переходах по папкам; подсчёты ограничены текущей страницей списка. В таблице по
умолчанию видны ограничения, назначенные запросы и средняя позиция. Для выбранных
поисковика/страны/региона/языка/устройства и дня средняя рассчитывается по
последнему замеру каждого назначенного отслеживаемого запроса в этот день,
если найден именно URL страницы или её alias. Не найдено, не измерено и найден
другой URL не превращаются в нулевые позиции. Покрытие замеров показывается
отдельно. Начальный режим — последний день со съёмом; ручная дата не сбрасывается
при обновлении данных.

Инспектор страницы имеет вкладки Обзор/Семантика/SEO/Ссылки/История и независимую
прокрутку. Карточка запроса показывает краткий статус целевого URL и отдельную
PAGE-вкладку. Открытие и наведение не запускают обход. Кнопка «Перепроверить» сразу создаёт worker operation для единственного выбранного URL без sitemap и discovery; сохранённые факты обновляются после завершения. Статусы robots, meta robots
и HTTP X-Robots-Tag подтверждаются собственным источником и датой, отдельно для
Google/Yandex. Отсутствовавшее в старом snapshot доказательство остаётся неизвестным.
Вкладка заметки занимает оставшуюся высоту, textarea не ресайзится, действия
доступны снизу.

Запросы статистики ограничены 100 page IDs; тяжёлые панели — 100 строками с
opaque scope-bound cursor. Входящие ссылки относятся к конкретному обходу и
не выдаются за полную или текущую структуру всего сайта. Средняя не является
реальным трафиком или доказательством индексации.

## 3. Каннибализация

Правило обнаружения учитывает:

- несколько URL проекта в TOP по одному запросу;
- смену ranking URL во времени;
- разные target assignments в одном кластере;
- близкие страницы с пересекающимися кластерами;
- canonical/redirect relationships.

Issue содержит:

- affected keywords;
- URLs;
- evidence snapshots;
- severity;
- confidence;
- recommendation;
- owner;
- status;
- false positive.

False positive сохраняет объяснение и может исключать повторное создание по тому же правилу.

## 4. Пропущенные посадочные

Система выявляет:

- кластер без target page;
- группа с достаточным спросом без подходящей страницы;
- competitor page без аналога;
- intent mismatch;
- target page с чрезмерно большим числом разнотипных кластеров.

Рекомендация содержит частотности, SERP overlap, конкурентов и используемую формулу потенциала.

## 5. Контентный workflow

Статусы:

- idea;
- research;
- brief;
- writing;
- review;
- approved;
- publishing;
- published;
- optimization;
- paused;
- rejected;
- archived.

Поля:

- title;
- page/plan;
- cluster;
- owner;
- due date;
- status;
- priority;
- brief;
- acceptance criteria;
- files;
- comments;
- private/client-visible.

## 6. Контентный бриф

Разделы:

- цель и intent;
- primary/secondary queries;
- recommended structure;
- competing pages;
- title/H1 suggestions;
- entities/terms;
- questions;
- internal links;
- external sources;
- metadata;
- constraints;
- checklist.

AI-generated части маркируются и содержат source evidence. Пользователь может заблокировать ручные секции от перегенерации.

## 7. Минимальный task management

Task:

- title;
- description;
- type;
- project;
- related entity;
- status;
- priority;
- assignee;
- reporter;
- due date;
- checklist;
- attachments;
- comments;
- visibility;
- estimate;
- created/updated/completed.

Views:

- list;
- board;
- my tasks;
- overdue;
- by page;
- by cluster.

Не требуется сложная система спринтов и dependency graph уровня Jira.

## 8. База знаний

### 8.1. Структура

- tree of documents;
- folders;
- favorites;
- recent;
- templates;
- trash.

### 8.2. Документ

- title;
- icon/cover;
- rich content;
- owner;
- project;
- visibility;
- linked entities;
- comments;
- Yjs state;
- snapshots;
- created/updated.

### 8.3. Редактор

- headings;
- text formatting;
- lists;
- checklists;
- tables;
- callouts;
- code;
- links;
- attachments;
- mentions;
- embeds of keyword/cluster/page/report;
- slash commands.

Совместное редактирование описано в `09-collaboration-reports-notifications.md`.

## 9. Файлы

- folders/tags;
- upload/download;
- preview common formats;
- version replacement;
- link to entities;
- access inherited from project plus explicit visibility;
- malware scanning;
- checksum and dedup;
- retention/trash;
- audit.

## 10. Технический crawl

Полноценный crawler может быть отдельным worker profile, но входит в целевой продукт.

### 10.1. Настройки

- start URLs;
- sitemap;
- depth;
- max URLs;
- concurrency;
- rate limit;
- user agent;
- obey robots;
- include/exclude patterns;
- cookies/headers;
- JS rendering optional;
- canonical handling;
- query parameters.

### 10.2. Собираемые данные

- URL and normalized URL;
- status code;
- redirect chain;
- response time;
- content type;
- size;
- title/description/H1;
- canonical;
- robots/meta robots;
- hreflang;
- language;
- headings;
- internal/external links;
- image alt;
- structured data;
- word count;
- content hash;
- sitemap presence;
- indexability;
- duplicate groups.

### 10.3. Безопасность crawler

- SSRF protection;
- запрет private/link-local/metadata IP;
- DNS rebinding protection;
- max response size;
- timeout;
- redirect limit;
- content-type allowlist;
- per-domain rate limit.

### 10.4. Radar: управляемый мониторинг изменений

Radar запускает повторный обход собственного сайта и явно добавленных страниц
конкурентов. Пользователь настраивает:

- scope: sitemap, page view, URL list, include/exclude patterns;
- интервал и timezone;
- допустимые часы обхода;
- скорость: requests per minute и concurrency;
- max URLs/run и max runtime;
- desktop/mobile user agent profile;
- conditional requests;
- уведомляемые поля и пороги;
- получателей и quiet hours.

Сравниваются:

- HTTP status и redirect chain;
- title, description, H1 и headings;
- canonical, robots, hreflang;
- structured data;
- content hash и значимые текстовые изменения;
- internal/external links;
- indexability;
- response time и размер;
- появление/исчезновение URL в sitemap.

Каждый запуск создаёт immutable `page_snapshot`; изменение создаёт
`page_change` с before/after hash, нормализованным diff, severity, источником и
ссылкой на job. Большой HTML хранится в S3 по отдельному retention, а
агрегированный change history — долговременно.

#### Politeness и защита доступности

- `robots.txt` соблюдается; для конкурентов его обход запрещён без исключений;
- используется идентифицируемый User-Agent с contact URL;
- default rate консервативен, увеличение проходит warning и plan limits;
- per-host distributed token bucket учитывает все workspaces;
- одновременно для host выполняется не более одного Radar/crawl job, если
  policy не разрешает иное;
- `ETag`, `Last-Modified`, sitemap `lastmod` и content hash используются для
  пропуска неизменившихся ресурсов;
- `429`, `503`, рост latency и connection errors включают exponential backoff,
  уменьшают concurrency и могут перевести host в `PAUSED_BY_SITE`;
- timeout, response-size, redirect и download budgets ограничены;
- JS rendering выключен по умолчанию, тарифицируется отдельно и выполняется в
  изолированном browser worker pool;
- anonymous Toolbox не использует Radar worker pool;
- API никогда не ждёт crawl синхронно: создаётся job;
- global crawl concurrency, CPU/memory limits и fair scheduling гарантируют,
  что Radar не вытесняет rankings, billing и интерактивные операции.

Состояния Radar:

- `NOT_CONFIGURED`;
- `SCHEDULED`;
- `QUEUED`;
- `RUNNING`;
- `BACKING_OFF`;
- `PAUSED_BY_USER`;
- `PAUSED_BY_SITE`;
- `PARTIAL`;
- `COMPLETED`;
- `FAILED`;
- `READ_ONLY_BILLING`.

### 10.5. Проектная проверка HTTP-статусов

Private-маршрут
`/app/projects/{projectId}/tools/http-status-checker` запускает отдельный по
смыслу тип операции `HTTP_STATUS_CHECK`, но переиспользует существующие
durable crawl Job, очередь, worker, checkpoint и page snapshot. Добавление
четвёртого сервиса или отдельной очереди для него запрещено без измеренной
необходимости.

Пользователь может выбрать доступный ему проект и один из источников:

- весь сайт: корневой URL, sitemap и внутренние ссылки;
- список URL вручную либо из TXT/CSV, по одному адресу в строке.

Все start/sitemap URL сервером привязываются к каноническому домену проекта;
одной frontend-проверки недостаточно. За запуск принимается от 1 до 5 000
страниц, доступны presets 100/250/500/1 000/2 500/5 000 и ручной лимит. Скорость задаётся
в страницах в секунду, но hard limit равен 4 страницам/с (240 requests/minute)
на host; `robots.txt`, SSRF/DNS-rebinding protection, timeout, response-size и
redirect budgets нельзя отключить. Полный site mode по умолчанию использует
консервативные 0,5 страницы/с; URL-list mode по умолчанию не расширяет scope
sitemap или ссылками, пока пользователь явно не включит эти опции.

Для `HTTP_STATUS_CHECK` можно независимо включить bounded проверки редиректов
главной: HTTP-вариант, альтернативный host с/без `www` и пути `//`, `///`,
`////`, `/////`. Клиент передаёт только enum-набор `homepageChecks`, а точные
URL строит Execution из проверенного корневого URL проекта. Эти адреса
резервируют место в `maxUrls`, проходят SSRF/DNS-rebinding protection и не
расширяют discovery на альтернативный origin. Для `TECHNICAL_AUDIT` параметр
запрещён.

Результат открывается на отдельной private/noindex странице операции и по
мере выполнения показывает authoritative `processedUrls` и уже сохранённые
строки. Обновление идёт не реже шага 10 страниц либо двух секунд. Таблица
содержит requested/final URL, конечный HTTP-код, redirect chain, response
time, size и content type; поддерживает поиск, 2xx/3xx/4xx/5xx, only redirects
и сортировку по коду, URL и времени ответа. Terminal notification ведёт в
этот exact result, а не в текущую карту страниц.

HTTP-проверка не является SEO-аудитом: она не создаёт issue occurrences,
duplicate analysis, absence membership и Radar change history и не очищает
SEO-поля существующей Page. Старые crawl без `purpose` читаются как
`TECHNICAL_AUDIT`.

Инструмент называется «Обход сайта». Опция «Сохранить карту страниц» включена
по умолчанию и передаётся как `savePageMap`. При выключенной опции immutable
snapshot результата всё равно сохраняется для журнала операции и его FK-backed
Page создаётся как `includedInMap=false`, но карта/источники Page не изменяются.
Кроме HTTP-полей snapshot сохраняет bounded meta tags и уже перечисленные в
10.2 SEO/скоростные метрики; это позволяет построить карту без повторного
запроса сайта. Public Core bridge принимает rolling Execution-конфиги как до,
так и после появления `savePageMap`, нормализует отсутствующее значение в
`true`, но продолжает fail-closed отклонять неизвестные или неверно типизированные
поля.

### 10.6. Генератор sitemap

Источник URL:

- page map;
- успешный crawl;
- импорт;
- Search Console/Вебмастер;
- ручной список;
- сохранённый page view.

Wizard:

1. источник и scope;
2. include/exclude rules;
3. canonical/indexability/status validation;
4. правила `lastmod`;
5. локали/hreflang;
6. разбиение файлов и sitemap index;
7. preview warnings;
8. generate/download/publish.

Требования:

- не более 50 000 URL и 50 MB uncompressed на один sitemap;
- превышение автоматически создаёт sitemap index;
- включаются только canonical indexable URL с допустимым HTTP status;
- `lastmod` указывается только при наличии достоверного источника изменения;
- gzip optional;
- результат версионируется, имеет checksum и хранится в S3;
- publish на сайт выполняется только через отдельно подтверждённую CMS/storage
  integration; по умолчанию доступно скачивание;
- поддерживается отправка/повторная отправка в Search Console и Вебмастер;
- показывается diff с предыдущей версией;
- пользователь может включить автообновление после успешного Radar/crawl, но
  публикация не происходит при critical validation errors.

## 11. Технические issues

Категории:

- 4xx/5xx;
- redirect chains/loops;
- duplicate metadata;
- missing/long/short metadata;
- canonical conflicts;
- robots blocked;
- orphan pages;
- broken internal links;
- hreflang errors;
- sitemap mismatches;
- duplicate content hashes;
- thin content;
- slow response;
- structured data issues;
- excessive depth;
- mixed protocols;
- pagination issues.

Issue:

- rule ID/version;
- severity;
- affected entities;
- first/last seen;
- evidence;
- status;
- assignee;
- false positive;
- resolvedAt;
- verification crawl.

## 12. Аналитика страниц

При подключении GSC/Webmaster/GA4/Метрики:

- impressions;
- clicks;
- CTR;
- average position;
- sessions/users;
- engagement;
- key events/conversions;
- revenue, если разрешено;
- landing page queries;
- comparison.

Данные разных систем показываются отдельно и не смешиваются без явной формулы.

## 13. Страница «Проблемы»

Объединяет:

- технические issues;
- каннибализацию;
- target URL mismatch;
- stale data;
- integration problems;
- lost positions;
- missing pages;
- content deadlines.

Фильтры:

- type;
- severity;
- status;
- owner;
- source;
- page/group;
- first/last seen.

Bulk actions:

- assign;
- change status;
- suppress;
- create task;
- export;
- verify.

## 14. Состояния

- crawl not configured;
- crawling;
- crawl partial;
- crawl cancelled;
- max URLs reached;
- robots denied;
- page data stale;
- analytics missing;
- competitor sync running;
- no competitors;
- no gap;
- issue suppressed;
- planned page;
- archived page;
- collaborator editing;
- permission restricted.


### Завершение больших технических обходов

Все этапы поддерживают 5000 URL: snapshot persistence, duplicate/membership
analysis, worker receipt, public parsers и уведомления. Четыре вида дублей
допускают 20000 occurrences и 10000 групп; одна группа содержит до 5000 страниц.
Полностью сохранённый checkpoint можно повторно финализировать без скачивания
страниц, даже после истечения времени обхода. Сбой финализации имеет отдельный
код `CRAWL_FINALIZATION_FAILED`; immutable evidence и tenant boundaries сохраняются.

### Пакетное выполнение и массовые действия карты

При скорости 3–4 страницы/с загрузки перекрываются ограниченным окном;
снимки и checkpoint фиксируются по порядку. Центр выдаёт пачку воркеру,
а protocol v2 agent запускает HTTP по общему для операции ограничителю,
включая redirects. Старый агент не получает такую работу; доступен резервный
фоновый воркер центра. Отмена и backoff не освобождают lease до завершения
выданных запросов.

Checkbox, Ctrl/Cmd и Shift выбирают страницы таблицы; ПКМ показывает общий
кастомный ContextMenu. Меню раздела применяет действие к полной owning
выборке, включая ещё не загруженные строки. Архивирование/восстановление
исполняет durable PAGE_STATUS_CHANGE worker с прогрессом и записью в админке;
все ID порции должны принадлежать проекту. Страницы с основными кластерами
сохраняются, их число отображается в результате. Повтор после потери ответа
не меняет версию страницы ещё раз. Архив допускает восстановление из того
же меню раздела.

Повторный обход с сохранением карты автоматически восстанавливает найденные
архивные страницы, включая условный HTTP 304. Сохраняются ID и пользовательские
связи/заметки. Перезапуск продолжает durable checkpoint; ранее сохранённые
снимки не удаляются. Повтор уже принятого receipt не отменяет более позднее
ручное архивирование.
