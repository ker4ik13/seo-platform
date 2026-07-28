# Единый web-сайт, Toolbox, Directus и административная панель

## 1. Доменные зоны

Шаблон:

- `example.com` — единый web-продукт;
- `example.com/app` — защищённое приложение;
- `example.com/tools` — индексируемый публичный Toolbox;
- `example.com/docs` — документация продукта;
- `example.com/docs/api` — документация публичного API;
- `admin.example.com` — внутренняя админка;
- `api.example.com` — machine API gateway и OpenAPI JSON;
- `status.example.com` — status page;
- `assets.example.com` — публичные оптимизированные assets при необходимости.

Бренд и фактический домен не фиксируются.

Все пользовательские web-маршруты принадлежат одному Next.js repository и
одной дизайн-системе. Это не отменяет серверную проверку сессии, tenant context
и permissions на `/app`.

## 2. Маршрутные и индексирующие зоны

### 2.1. Публичная зона

Публичные индексируемые маршруты:

- `/`;
- `/features/**`;
- `/integrations/**`;
- `/pricing`;
- `/articles/**`;
- `/cases/**`;
- `/tools`;
- `/tools/{toolSlug}`;
- `/docs/**`, включая `/docs/api/**`;
- локализованные эквиваленты.

Страницы результатов публичных инструментов, preview, пользовательские query
parameters и временные share URL по умолчанию не индексируются. Индексируется
посадочная страница инструмента с редакционным описанием и статическим примером,
а не произвольно сгенерированный пользователем результат.

### 2.2. Зона приложения

Все маршруты `/app`:

- требуют сессию, кроме контролируемого auth flow;
- возвращают `X-Robots-Tag: noindex, nofollow, noarchive`;
- имеют Next.js metadata `robots: noindex, nofollow`;
- перечислены в `robots.txt` как `Disallow: /app`;
- не попадают в sitemap, RSS, внутренний публичный поиск и публичный cache;
- используют `Cache-Control: private, no-store` для tenant-данных.

Отсутствие сессии приводит к redirect на вход с безопасным `returnTo`, а не к
рендерингу данных в HTML. Защита маршрута не считается проверкой permissions:
каждый API-запрос отдельно проверяет workspace/project access.

Browser-запросы приложения идут через same-origin BFF `/app/api/**`, который:

- проксирует только публичный `/api/v1` Platform API по внутренней сети;
- не делает HttpOnly cookie доступными JavaScript;
- передаёт CSRF, `If-Match`, idempotency и correlation headers;
- сохраняет несколько `Set-Cookie` без склейки;
- не кэширует tenant responses;
- не заменяет backend authentication, tenant context и permission guards.

Server Components передают cookies только Platform API. При истёкшем access
cookie контролируемый refresh route ротирует session и возвращает пользователя
только на проверенный локальный `returnTo`.

## 3. Цели публичного сайта

- объяснить ценность продукта;
- конвертировать посетителя в регистрацию/trial/demo;
- продвигаться в поисковых системах;
- публиковать документацию и обучающий контент;
- сравнивать функции и тарифы;
- показывать интеграции;
- собирать заявки enterprise;
- поддерживать локализованные landing pages;
- сообщать об обновлениях.
- давать полезные бесплатные SEO-инструменты с низким порогом входа;
- конвертировать результат публичного инструмента в регистрацию и проект;
- публиковать версионированную документацию и примеры публичного API.

## 4. Страницы сайта

Обязательные:

- Home;
- Product overview;
- Features;
- отдельные страницы модулей;
- Integrations catalog;
- Integration detail;
- Pricing;
- For agencies;
- For in-house teams;
- For specialists;
- Enterprise;
- Customer stories/cases;
- Blog;
- Blog article;
- Changelog;
- Documentation entry;
- About;
- Contact/demo;
- Security;
- Status link;
- Login/signup redirects;
- Terms;
- Privacy;
- Cookie policy;
- DPA;
- Acceptable use;
- 404/500;
- search.
- Toolbox catalog;
- отдельная SEO-страница каждого инструмента;
- API overview, authentication, quick start, errors, pagination и webhooks;
- API reference по capability;
- OpenAPI download и changelog API.

## 5. SEO сайта

Для каждой индексируемой страницы:

- locale-specific slug;
- canonical;
- hreflang;
- title;
- description;
- OG/Twitter;
- robots;
- structured data;
- breadcrumbs;
- author/date where relevant;
- sitemap inclusion;
- image alt;
- redirect history.

Требования:

- server rendering/static generation;
- XML sitemaps по типам и локалям;
- sitemap index;
- robots.txt из CMS с защитой от критической ошибки;
- redirect registry;
- noindex для preview/staging;
- JSON-LD templates;
- Core Web Vitals;
- responsive images;
- no orphan marketing pages;
- automated broken link checks.
- автоматическая проверка, что `/app`, временные результаты и preview не
  попали в sitemap или индексируемый route manifest;
- уникальный редакционный текст для страницы каждого Toolbox-инструмента;
- отсутствие массовой генерации thin pages по введённым URL/ключам;
- schema.org `SoftwareApplication`/`WebApplication` для Toolbox только там,
  где разметка соответствует видимому содержимому.

## 6. Публичный Toolbox

### 6.1. Принцип общей реализации

Публичный и проектный Toolbox не являются отдельными наборами функций.
`ToolCapability` определяет:

- стабильный `code` и версию;
- локализуемое название и описание;
- input/output JSON Schema;
- доступность anonymous/free/paid;
- требуемые providers;
- синхронный preview и асинхронный run;
- estimate/cost unit;
- rate limits и max input;
- retention результата;
- возможность сохранить результат в проект;
- API operation IDs;
- UI renderer и состояния.

Один domain handler используется маршрутами:

- `/tools/{toolSlug}` — публичный сценарий;
- `/app/.../projects/{projectId}/tools/{toolSlug}` — проектный сценарий;
- `api.example.com/v1/tools/{toolCode}/...` — API.

Публичный результат временный и не содержит project data. После входа
пользователь может явно сохранить совместимый результат в выбранный проект.
Проектный запуск сохраняет provenance, job, стоимость и историю в tenant scope.

### 6.2. Стартовый каталог

- проверка HTTP status/redirect chain;
- preview title/description/H1/canonical/robots;
- проверка indexability одного URL;
- robots.txt tester;
- sitemap validator;
- SERP snippet preview;
- нормализация и очистка небольшого списка ключей;
- удаление явных/неявных дублей;
- word/character/n-gram counter;
- кластеризация, частотность, SERP и другие платные инструменты после входа,
  estimate и подтверждения стоимости.

Каталог расширяется capability registry без создания отдельной архитектуры.

### 6.3. Anonymous abuse protection

- IP/device/account limits;
- CAPTCHA только после risk threshold;
- малые hard limits input;
- SSRF-защита URL-инструментов;
- отдельный низкоприоритетный queue class;
- cache безопасных нормализованных результатов;
- запрет browser rendering для anonymous по умолчанию;
- платные provider calls только после входа и явного подтверждения;
- один anonymous tenant не может вытеснить project jobs.

## 7. Документация публичного API

Документация находится на `/docs/api` в том же web-продукте, но имеет отдельную
навигацию и visual mode. Она включает:

- quick start;
- создание и rotation API token;
- scopes и workspace/project restrictions;
- authentication и security;
- rate limits и quota headers;
- idempotency;
- estimate → approve → job → result flow;
- все SEO capabilities;
- imports/exports;
- webhooks;
- error catalog;
- SDK/examples для TypeScript, Python, cURL;
- OpenAPI version selector и migration guides;
- API status/changelog.

Reference генерируется из versioned OpenAPI в `platform-contracts`; Directus
хранит guides, tutorials и пояснения, но не дублирует схемы вручную. API
Explorer не сохраняет токен в CMS, analytics или server logs.

## 8. CMS Directus

Directus управляет только контентом маркетингового сайта и документационными материалами. Он не является источником истины для пользователей, проектов, billing и jobs приложения.

## 9. Directus collections

### 9.1. Настройки

`site_settings`:

- site name;
- default locale;
- logo variants;
- favicon;
- social links;
- default SEO;
- analytics IDs;
- contact;
- maintenance banner.

### 9.2. Локали

`locales`:

- code;
- label;
- enabled;
- default;
- fallback;
- direction;
- date/number settings.

### 9.3. Страницы

`pages`:

- ID;
- status;
- page type;
- template;
- parent;
- sort;
- publishedAt;
- created/updated;
- author.

`page_translations`:

- page;
- locale;
- slug;
- title;
- lead;
- blocks;
- SEO relation;
- navigation label.

### 9.4. SEO

`seo_meta`:

- title;
- description;
- canonical override;
- robots;
- OG;
- Twitter;
- structured data type;
- schema fields;
- sitemap priority/changefreq;
- exclude from sitemap.

### 9.5. Блоки

Используется block registry, а не произвольный HTML.

Типы:

- hero;
- rich text;
- feature grid;
- feature comparison;
- metrics;
- screenshots;
- video;
- integrations;
- pricing teaser;
- CTA;
- testimonials;
- logo wall;
- FAQ;
- steps;
- tabs;
- quote;
- case teaser;
- article list;
- changelog list;
- newsletter;
- form;
- custom code только для super admin.

Каждый блок имеет:

- status/visibility;
- translations;
- design variant;
- spacing;
- anchor;
- analytics ID;
- schedule;
- audience/experiment optional.

### 9.6. Навигация

- menus;
- menu items;
- nesting;
- locale;
- internal/external;
- target;
- visibility;
- auth state.

### 9.7. Контент

- articles;
- article translations;
- categories;
- tags;
- authors;
- cases;
- testimonials;
- FAQs;
- changelog entries;
- security updates;
- integration catalog;
- feature catalog;
- comparison pages;
- legal documents.
- tool landing content, examples and FAQs;
- API guides/tutorials/changelog, но не generated reference schemas.

### 9.8. Формы

- form definitions;
- fields;
- destinations;
- consent text/version;
- submissions;
- spam score;
- processing status.

Sensitive submissions имеют отдельные permissions и retention.

### 9.9. Redirects

- source;
- destination;
- status 301/302/307/308;
- locale;
- active;
- starts/ends;
- hit count optional.

Проверяются loops и chains.

## 10. Editorial workflow

Статусы:

- draft;
- in_review;
- changes_requested;
- approved;
- scheduled;
- published;
- archived.

Роли:

- author;
- editor;
- translator;
- SEO editor;
- publisher;
- CMS admin.

Публикация:

- требует обязательных SEO полей по шаблону;
- проверяет slug uniqueness;
- проверяет broken internal links;
- создаёт cache revalidation webhook;
- сохраняет version/revision;
- поддерживает scheduled publish/unpublish.

Directus content versioning используется для draft variants и rollback.

## 11. Pricing на сайте

Фактические тарифы и цены принадлежат billing service.

Сайт получает опубликованный pricing catalog через read-only API или build-time sync. Directus хранит:

- маркетинговые описания;
- порядок;
- highlighted features;
- FAQ;
- CTA.

CMS не может изменить фактическую сумму списания.

## 12. Интеграции на сайте

Каталог содержит:

- provider;
- logo;
- categories;
- description;
- capabilities;
- setup guide;
- availability by plan;
- status/deprecated;
- locales.

Техническая availability синхронизируется из integration registry, маркетинговый текст — из Directus.

## 13. Preview

- CMS preview использует подписанный short-lived token.
- Preview URL имеет noindex.
- Draft не попадает в публичный cache.
- Preview показывает locale и responsive mode.
- Сотрудник не должен логиниться в production app для просмотра CMS preview.

## 14. Web-состояния

- published;
- scheduled;
- draft preview;
- locale missing with fallback;
- CMS unavailable with stale cache;
- form success;
- form validation;
- form server error;
- rate limited/spam;
- maintenance banner;
- pricing API unavailable;
- 404;
- 500.
- anonymous tool ready/running/rate-limited;
- tool result ready/expired;
- sign-in required to increase limits;
- save-to-project chooser;
- API schema version unavailable;
- `/app` unauthenticated/forbidden/read-only.

## 15. Внутренняя административная панель

Собственное Next.js-приложение на `admin.example.com`.

Доступно только platform roles. Доступ защищён обязательной 2FA, IP/risk policies и отдельным audit.

## 16. Разделы admin

### Dashboard

- registrations;
- active workspaces;
- subscriptions/MRR;
- jobs;
- provider health;
- queue lag;
- incidents;
- support load;
- storage.

### Users

- поиск;
- status;
- auth methods;
- sessions;
- 2FA;
- memberships;
- security events;
- suspend/unlock;
- initiate verified email change;
- GDPR export/delete status.

Пароли и OAuth tokens не отображаются.

### Workspaces

- status;
- owner;
- plan;
- usage;
- projects;
- members;
- budgets;
- integrations state;
- audit;
- support access.

### Projects

- metadata;
- usage;
- jobs;
- data volume;
- integrations;
- archive/recover;
- diagnostic tools.

Администратор не должен редактировать SEO-данные без support session.

### Roles and staff

- platform staff accounts;
- roles;
- permissions;
- mandatory 2FA;
- access reviews;
- audit.

### Plans and features

- plan drafts;
- versioning;
- limits;
- price catalog;
- feature flags;
- publication;
- migration preview.

### Billing

- subscriptions;
- payments;
- invoices;
- ledger;
- refunds;
- adjustments;
- promo codes;
- reconciliation;
- failed webhooks.

### Integrations

- registry;
- connector versions;
- platform credential pools;
- price books;
- capability flags;
- health;
- circuit breakers;
- deprecation notices.

Полные platform secrets не показываются после сохранения.

### Jobs and queues

- search job;
- queues;
- workers;
- lag;
- retries;
- DLQ;
- cancel;
- replay;
- cost;
- raw diagnostics by permission.

### Feature flags

- key;
- description;
- environments;
- workspace/user targeting;
- percentage rollout;
- prerequisites;
- owner;
- expiry/review date;
- audit.

### Reports and notifications

- template versions;
- render failures;
- deliveries;
- bounces;
- webhook failures;
- resend.

### Support

- tickets/integration;
- customer context;
- time-limited support session;
- notes;
- actions;
- escalation.

### Security

- suspicious logins;
- locked accounts;
- secret access audit;
- admin actions;
- webhook signature failures;
- rate limit attacks;
- data export/delete requests.

### System

- service health;
- migrations;
- app versions;
- maintenance mode;
- global banners;
- environment config references;
- status page incident controls.

## 17. Опасные admin-действия

Требуют step-up authentication и reason:

- impersonation/support session;
- refund;
- balance adjustment;
- workspace suspension;
- data deletion;
- platform credential replacement;
- feature rollout > threshold;
- replay financial webhook;
- change platform role.

Некоторые действия требуют four-eyes approval выше настраиваемого порога.

## 18. Status page

Компоненты:

- public web/Toolbox/docs;
- `/app`;
- API;
- jobs;
- integrations by provider group;
- notifications;
- billing.

Incident:

- investigating;
- identified;
- monitoring;
- resolved.

Публичный status не раскрывает внутренние детали и секреты.
