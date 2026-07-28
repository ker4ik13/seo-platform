# Асинхронные задания, автоматизации и интеграции

## 1. Принцип

Любая операция, которая может превысить 2 секунды, затронуть более 1 000 строк, обратиться к внешнему API или потребовать расчёта стоимости, должна иметь возможность выполняться асинхронно.

## 2. Модель Job

Поля:

- `id`;
- `workspaceId`;
- `projectId`;
- `type`;
- `status`;
- `stage`;
- `priority`;
- `actorId`;
- `scheduleId`;
- `parentJobId`;
- `deduplicationKey`;
- `idempotencyKey`;
- `inputSnapshot`;
- `scopeSnapshot`;
- `progressCurrent`;
- `progressTotal`;
- `progressUnit`;
- `estimatedCost`;
- `reservedCost`;
- `actualCost`;
- `currency`;
- `credentialMode`;
- `provider`;
- `attempt`;
- `maxAttempts`;
- `createdAt`;
- `queuedAt`;
- `startedAt`;
- `finishedAt`;
- `cancelRequestedAt`;
- `errorSummary`;
- `resultSummary`;
- `correlationId`;
- `version`.

## 3. Статусы Job

- `DRAFT`;
- `ESTIMATING`;
- `AWAITING_APPROVAL`;
- `RESERVING_BALANCE`;
- `QUEUED`;
- `WAITING_RATE_LIMIT`;
- `RUNNING`;
- `PAUSE_REQUESTED`;
- `PAUSED`;
- `CANCEL_REQUESTED`;
- `CANCELLED`;
- `RETRY_SCHEDULED`;
- `PARTIALLY_COMPLETED`;
- `COMPLETED`;
- `FAILED_RETRYABLE`;
- `FAILED_FINAL`;
- `EXPIRED`.

Статус и stage различаются: `RUNNING` может иметь stages `FETCHING`, `PARSING`, `SAVING`, `AGGREGATING`.

## 4. Job item

Для пакетных заданий создаются логические items/chunks:

- input reference;
- status;
- provider request ID;
- attempt;
- output reference;
- cost;
- error code;
- retryAt;
- timestamps.

Миллионы items не должны бесконтрольно храниться в Redis. Каноническое состояние хранится в PostgreSQL/staging/object storage, а Redis содержит очередь и оперативное состояние.

## 5. Идемпотентность

- POST запуска принимает `Idempotency-Key`.
- Повтор с тем же ключом и тем же payload возвращает существующий результат.
- Повтор с отличающимся payload возвращает конфликт.
- Provider callbacks и poll results также обрабатываются идемпотентно.
- Side effects биллинга используют отдельные уникальные ledger references.

## 6. Отмена и пауза

- Отмена является cooperative.
- Worker проверяет cancel flag между chunks и внешними запросами.
- Уже оплаченный provider request может быть завершён и сохранён.
- UI показывает, что отмена запрошена.
- Пауза сохраняет checkpoint.
- Не все job types поддерживают pause; это отражается в capabilities.

## 7. Retry

Классы ошибок:

- authentication;
- permission;
- invalid input;
- rate limit;
- provider temporary;
- network;
- parse;
- internal retryable;
- internal final;
- insufficient balance;
- cancelled.

Политика:

- exponential backoff с jitter для network/5xx;
- `Retry-After` имеет приоритет для 429;
- authentication не повторяется автоматически бесконечно;
- invalid input не повторяется;
- max attempts зависит от connector;
- retry только failed items;
- manual retry создаёт новую attempt chain.

## 8. Очереди BullMQ

Базовые очереди:

- `imports`;
- `exports`;
- `rankings`;
- `serp`;
- `frequencies`;
- `suggestions`;
- `competitors`;
- `clustering`;
- `crawls`;
- `analytics-sync`;
- `reports`;
- `notifications`;
- `maintenance`.

Workers разделяются по профилю ресурсов:

- IO-bound;
- CPU-bound;
- browser-rendering;
- large-memory;
- report-rendering.

Rate limiting настраивается по provider и credential. Нельзя полагаться только на общий limiter очереди; connector поддерживает распределённые quota buckets.

## 9. Приоритеты и справедливость

Приоритеты:

- system critical;
- interactive high;
- paid priority;
- normal;
- background;
- maintenance.

Должна предотвращаться ситуация, когда один крупный workspace блокирует остальных:

- per-workspace concurrency;
- weighted fair scheduling;
- per-provider quota;
- per-credential quota;
- max active chunks per job;
- plan-based limits.

## 10. Automation

Automation состоит из:

- trigger;
- conditions;
- action;
- scope;
- provider policy;
- budget policy;
- notification policy;
- timezone;
- status;
- version.

### 10.1. Triggers

- cron/schedule;
- data became stale;
- position changed;
- keyword entered/exited TOP;
- new issue;
- integration error;
- balance threshold;
- import completed;
- page published;
- webhook event;
- manual.

### 10.2. Conditions

- project/group/tag/view;
- frequency threshold;
- priority;
- severity;
- business hours;
- previous run status;
- maximum frequency;
- minimum balance;
- no equivalent active job.

### 10.3. Actions

- run collector;
- refresh stale data;
- create issue/task;
- send notification;
- generate/send report;
- execute webhook;
- switch provider;
- pause schedule;
- tag entities;
- create snapshot.

## 11. Automation builder

Шаги:

1. name and description;
2. trigger;
3. scope;
4. conditions;
5. action;
6. source/fallback;
7. budgets;
8. notifications;
9. test/dry run;
10. enable.

Показывается human-readable summary: «Каждый понедельник в 02:00 Europe/Moscow обновлять точную частотность запросов старше 60 дней в группе X, но не более N единиц и M валюты».

## 12. Защита автоматизаций

- monthly/daily budget;
- per-run max cost;
- max items;
- max duration;
- no overlapping run;
- skip or queue behavior;
- failure threshold;
- circuit breaker;
- auto-pause after consecutive failures;
- notification on auto-pause.

## 13. Job Scheduler

- Для повторяемых jobs используются актуальные BullMQ Job Schedulers.
- Scheduler ID стабилен и связан с Automation version.
- Изменение schedule выполняется upsert без дублирования.
- Timezone/DST тестируются отдельно.
- Пропущенный запуск имеет policy: skip, run once, catch up limited.

## 14. Интеграции: уровни

### Workspace integration

Credentials и OAuth connections принадлежат workspace.

### Project binding

Проект выбирает:

- разрешённые connectors;
- конкретное credential;
- primary/fallback;
- budgets;
- context mapping.

### Platform credential

Системный секрет платформы, доступный только connector worker и billing policy.

## 15. Credential modes

- `BYOK_API_KEY`;
- `BYOK_OAUTH`;
- `PLATFORM_INCLUDED`;
- `PLATFORM_PAID`;
- `FALLBACK_PLATFORM_PAID`.

В job сохраняется выбранный mode. Секрет в job payload не передаётся; передаётся credential reference.

## 16. Экран интеграций

Карточка показывает:

- provider;
- статус;
- credential mode;
- account label;
- scopes;
- доступные функции;
- balance/quota, если доступно;
- last success;
- last error;
- usage;
- projects using;
- test;
- rotate/reconnect/delete.

Статусы:

- not connected;
- connecting;
- active;
- degraded;
- rate limited;
- low balance;
- token expiring;
- expired;
- revoked;
- invalid;
- provider outage;
- disabled by platform.

## 17. Добавление API-ключа

1. выбор provider;
2. описание возможностей и требуемого тарифа;
3. ввод секрета;
4. optional account identifier;
5. server-side test;
6. scopes/capabilities;
7. label and sharing scope;
8. default/fallback settings;
9. save.

Секрет после сохранения показывается только masked. Получить исходное значение нельзя; можно заменить.

## 18. OAuth connections

- OAuth state хранится server-side.
- Refresh token шифруется.
- Scopes минимальны.
- Пользователь видит предоставленные permissions.
- Disconnect отзывает локальное connection и по возможности provider token.
- Token refresh выполняется централизованно.
- Ошибка refresh переводит connection в `REAUTH_REQUIRED`.

## 19. Connector interface

Каждый connector реализует:

- metadata;
- capabilities;
- credential schema;
- validateCredential;
- fetchQuota/balance;
- estimate;
- normalizeInput;
- execute или submit/poll/get;
- cancel, если поддерживается;
- parseResponse;
- normalizeError;
- calculateActualCost;
- healthCheck;
- redact;
- version.

Результат connector преобразуется в канонические модели платформы. Сырой ответ не должен протекать в доменную логику.

## 20. Версионирование connector

- Connector имеет semantic version.
- Job фиксирует version.
- Parser changes не меняют старые snapshots молча.
- Возможен reparse raw response новым parser как отдельный job.
- Deprecation провайдера сопровождается миграционным уведомлением.

## 21. Начальные connectors

Приоритет P2:

1. XMLStock;
2. Arsenkin Tools;
3. Keys.so.

Яндекс Wordstat API, XMLRiver, Яндекс Вебмастер, Яндекс Метрика, Google Search Console и Google Analytics 4 остаются в целевой архитектуре, но реализуются после первой тройки либо раньше только при отдельном продуктовом решении.

### 21.1. Яндекс Wordstat API

Функции:

- top requests;
- dynamics;
- regions;
- device filters, если поддерживаются;
- OAuth bearer token;
- сохранение request context.

Connector учитывает provider quotas и не подменяет официальные значения вычисленными.

### 21.2. XMLRiver

- Яндекс/Google SERP;
- regions/languages/devices;
- result depth;
- organic results;
- special blocks;
- indexation options, если доступны;
- XML parsing;
- balance and provider errors.

### 21.3. XMLStock

- Яндекс/Google SERP;
- Wordstat;
- официальные и live-инструменты провайдера;
- XML/JSON/HTML response modes;
- balance, load and tariff metadata, если API разрешает.
- режимы первого релиза: BYOK и developer/partner integration;
- platform-paid режим включается только после согласования допустимой схемы коммерческого использования;
- `soft_id`/партнёрская атрибуция поддерживаются как часть connector configuration.

### 21.4. Keys.so

- REST JSON;
- API token header;
- domain/keyword reports;
- competitor keywords/pages;
- SERP tasks;
- async `202` polling;
- `429 Retry-After`;
- provider report IDs.
- в первом релизе используется только BYOK;
- пользователь должен иметь тариф Keys.so с доступом к API;
- общий ключ платформы запрещено включать до подписания отдельного соглашения, разрешающего предоставление данных пользователям платформы;
- интерфейс должен явно указывать, что подписка Keys.so оплачивается пользователем отдельно.

### 21.5. Arsenkin Tools

- Bearer token;
- submit/check/get task lifecycle;
- лимит одновременных задач;
- запросный rate limit;
- clustering;
- indexation and supported SEO tools;
- provider task cleanup.
- в первом релизе используется BYOK;
- пользователь должен иметь тариф Arsenkin Tools с API;
- platform-paid режим включается только после согласования с провайдером коммерческой схемы и передачи результатов третьим лицам;
- connector учитывает не более пяти одновременных задач и общий запросный rate limit провайдера.

### 21.6. Яндекс Вебмастер

- OAuth;
- sites;
- verification status;
- indexing diagnostics;
- search queries and statistics;
- sitemap data;
- API version stored in connector.

### 21.7. Яндекс Метрика

- OAuth;
- counters;
- reports;
- dimensions/metrics;
- goals/conversions;
- quota-aware sync.

### 21.8. Google Search Console

- OAuth;
- properties;
- Search Analytics;
- Sitemaps;
- Sites;
- URL Inspection;
- dimensions country/device/query/page/date;
- quota-aware incremental sync.

### 21.9. Google Analytics 4

- OAuth or service account where appropriate;
- Data API;
- metadata discovery;
- `runReport`/batch;
- pages, traffic, engagement and key events;
- pagination;
- quota tokens.

### 21.10. Telegram

- user authentication;
- workspace notification bot;
- user/chat binding;
- report and alert delivery;
- delivery result.

### 21.11. Email

- transactional provider abstraction;
- рекомендуемый первый transport — Unisender Go через API/SMTP;
- templates by locale;
- bounce/complaint handling;
- unsubscribe for non-transactional messages;
- delivery events.

### 21.12. Webhooks

- outbound signed webhooks;
- inbound automation triggers;
- retry and delivery log;
- endpoint verification.

## 22. Platform-key usage

При отсутствии BYOK:

1. Policy проверяет тариф и доступность функции.
2. Estimate рассчитывается по актуальному price book.
3. Создаётся balance reservation.
4. Credential broker выдаёт worker краткоживущий access reference.
5. Connector выполняет запрос.
6. Usage metering фиксирует provider units.
7. Ledger списывает actual cost.
8. Секрет не попадает в API, WebSocket и пользовательские логи.

На старте platform-paid разрешён только для provider/capability, по которому одновременно выполнены условия:

- договор или публичные условия разрешают выбранную модель использования;
- настроен действующий price book;
- подтверждены минимальные обязательства и лимиты провайдера;
- forecasted оплаченный спрос покрывает фиксированную стоимость provider account;
- включены hard daily/monthly budgets и аварийное отключение;
- проведён reconciliation test.

Наличие технического API само по себе не означает право перепродавать результаты или предоставлять общий доступ.

## 23. Provider price book

Содержит:

- provider;
- operation;
- unit;
- provider cost;
- customer price;
- currency;
- minimum charge;
- effective period;
- plan overrides;
- region/device modifiers;
- version.

Job фиксирует price book version.

Customer price вычисляется не как произвольная наценка, а по формуле, учитывающей:

- фактическую стоимость provider unit;
- неиспользованные/сгорающие обязательные пакеты;
- прямую стоимость worker/storage/traffic;
- комиссию платёжного провайдера;
- налоговый резерв;
- резерв изменения цены/курса;
- целевую contribution margin.

Price book автоматически блокирует публикацию цены ниже установленного floor.

## 24. Circuit breaker

Для connector/credential:

- closed;
- open;
- half-open.

Открывается по:

- error rate;
- consecutive failures;
- provider outage;
- authentication failure;
- balance depletion.

UI показывает degraded provider. Jobs либо ждут, либо применяют fallback policy.

## 25. Внутренняя панель операций

Platform operations видит:

- queues;
- worker capacity;
- lag;
- provider health;
- rate limits;
- credential pools;
- failed jobs;
- retry storms;
- costs and margin;
- circuit breakers;
- DLQ;
- manual replay.

Любой replay идемпотентен и аудитируется.
