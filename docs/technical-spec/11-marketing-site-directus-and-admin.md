# Маркетинговый сайт, Directus и административная панель

## 1. Доменные зоны

Шаблон:

- `example.com` — маркетинговый сайт;
- `app.example.com` — приложение;
- `admin.example.com` — внутренняя админка;
- `api.example.com` — API gateway;
- `docs.example.com` — документация;
- `status.example.com` — status page;
- `assets.example.com` — публичные оптимизированные assets при необходимости.

Бренд и фактический домен не фиксируются.

## 2. Цели маркетингового сайта

- объяснить ценность продукта;
- конвертировать посетителя в регистрацию/trial/demo;
- продвигаться в поисковых системах;
- публиковать документацию и обучающий контент;
- сравнивать функции и тарифы;
- показывать интеграции;
- собирать заявки enterprise;
- поддерживать локализованные landing pages;
- сообщать об обновлениях.

## 3. Страницы сайта

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

## 4. SEO сайта

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

## 5. CMS Directus

Directus управляет только контентом маркетингового сайта и документационными материалами. Он не является источником истины для пользователей, проектов, billing и jobs приложения.

## 6. Directus collections

### 6.1. Настройки

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

### 6.2. Локали

`locales`:

- code;
- label;
- enabled;
- default;
- fallback;
- direction;
- date/number settings.

### 6.3. Страницы

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

### 6.4. SEO

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

### 6.5. Блоки

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

### 6.6. Навигация

- menus;
- menu items;
- nesting;
- locale;
- internal/external;
- target;
- visibility;
- auth state.

### 6.7. Контент

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

### 6.8. Формы

- form definitions;
- fields;
- destinations;
- consent text/version;
- submissions;
- spam score;
- processing status.

Sensitive submissions имеют отдельные permissions и retention.

### 6.9. Redirects

- source;
- destination;
- status 301/302/307/308;
- locale;
- active;
- starts/ends;
- hit count optional.

Проверяются loops и chains.

## 7. Editorial workflow

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

## 8. Pricing на сайте

Фактические тарифы и цены принадлежат billing service.

Сайт получает опубликованный pricing catalog через read-only API или build-time sync. Directus хранит:

- маркетинговые описания;
- порядок;
- highlighted features;
- FAQ;
- CTA.

CMS не может изменить фактическую сумму списания.

## 9. Интеграции на сайте

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

## 10. Preview

- CMS preview использует подписанный short-lived token.
- Preview URL имеет noindex.
- Draft не попадает в публичный cache.
- Preview показывает locale и responsive mode.
- Сотрудник не должен логиниться в production app для просмотра CMS preview.

## 11. Сайт: состояния

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

## 12. Внутренняя административная панель

Собственное Next.js-приложение на `admin.example.com`.

Доступно только platform roles. Доступ защищён обязательной 2FA, IP/risk policies и отдельным audit.

## 13. Разделы admin

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

## 14. Опасные admin-действия

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

## 15. Status page

Компоненты:

- marketing site;
- app;
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

