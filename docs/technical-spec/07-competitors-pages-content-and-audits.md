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

