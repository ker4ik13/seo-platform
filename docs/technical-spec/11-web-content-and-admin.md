# Единый Web, контент, Toolbox и административная панель

## 1. Доменные зоны и маршруты

- основной domain — public Web;
- `/app` — защищённое tenant-приложение;
- `/admin` — защищённая platform operations-панель;
- `/tools` — индексируемый публичный Toolbox;
- `/docs` и `/docs/api` — документация;
- отдельный API domain — machine API/OpenAPI;
- отдельный status domain — независимая status page.

Все пользовательские web-маршруты принадлежат одному Next.js deployable и
одной дизайн-системе. Фактический бренд/domain задаются окружением.

## 2. Public routes

Индексируемая зона включает home, features, integrations, pricing, audience
landings, cases, articles/changelog, legal/security, localized routes,
Toolbox landing и API docs. Для каждой страницы обязательны:

- locale-specific slug, canonical и hreflang;
- title/description, Open Graph/Twitter и breadcrumbs;
- structured data и доступные alt labels;
- sitemap inclusion и redirect history;
- SSR/static generation, responsive images и Core Web Vitals budgets.

Preview, query-generated results, staging и temporary share URLs по умолчанию
`noindex`. `robots.txt` имеет безопасный статический baseline и не может
случайно запретить весь production site.

Маркетинговый контент текущей версии хранится как типизированный source рядом
с frontend. Контент проходит обычный Git review, localization/links/schema
tests и выпускается вместе с frontend. Внешний CMS можно добавить только
после появления реального редакционного workflow отдельным ADR; ему нельзя
давать доступ к application databases.

## 3. Private `/app`

Все tenant routes:

- требуют session, кроме контролируемого auth flow;
- имеют metadata и `X-Robots-Tag: noindex, nofollow, noarchive`;
- исключены из robots/sitemap/public search/cache;
- возвращают `Cache-Control: private, no-store` для tenant data;
- не считают route protection заменой backend permission checks.

Browser обращается через same-origin BFF `/app/api/**`. BFF проксирует только
allowlisted public Core API paths, сохраняет `Set-Cookie`, CSRF, `If-Match`,
idempotency/correlation headers, запрещает redirects и не раскрывает HttpOnly
cookies JavaScript. Истёкшая access session обновляется контролируемым refresh
route с проверенным локальным `returnTo`.

Основные состояния каждого экрана: loading, empty, error, degraded, forbidden
и stale/conflict. Долгая операция показывает authoritative server state, а не
считает WebSocket-событие завершением.

## 4. Public Toolbox

Toolbox catalog содержит category, input schema, limits, cost mode,
availability, documentation и SEO metadata. Public и project variants
используют один capability registry и backend implementation.

В текущем релизе anonymous runner отсутствует: `/tools` является
индексируемой входной страницей и ведёт в защищённый project catalog. Ранее
экспонировавшиеся очистка ключевых фраз и preview сниппета удалены вместе с
прямыми маршрутами; карточка без production workflow не публикуется.

Публичный запуск защищён rate limits, bot/abuse controls, input/body limits и
low-priority queue. Result page не индексируется, не раскрывает credentials и
может предложить регистрацию/перенос результата в проект. Недоступный
provider честно возвращает degraded/unavailable, а не demo-success.

### 4.1. Каталог инструментов внутри `/app`

Private-каталог `/app/tools` содержит только реально реализованные project
workflows с tenant permission boundary и durable operation history. Пустая
секция «Доступные для всех», заглушки и карточки будущих инструментов не
публикуются.

Первый project workflow — `HTTP_STATUS_CHECK`; его маршрут, ограничения и
результат определены в разделе 10.5 документа
`07-competitors-pages-content-and-audits.md`.

## 5. API documentation

`/docs/api` генерируется из versioned contracts в `packages/contracts` и
покрывает auth, permissions, errors, pagination, idempotency, rate limits,
webhooks, examples и changelog. OpenAPI JSON доступен также через API domain.
Документация не содержит production secrets или внутренних endpoint names.

## 6. `/admin`

Admin — route boundary единого frontend, а не отдельный deployable. Он
использует `/admin/api/**` BFF и публичный admin surface Core.

Обязательные возможности:

- accounts/workspaces/projects lookup;
- plans/subscriptions/billing/ledger operations;
- payment and НПД obligations;
- job/provider/queue diagnostics и bounded retry/cancel actions;
- support, feature flags/kill switches и audit views;
- data export/erasure workflow.

Admin route требует platform role, MFA/2FA policy и recent authentication для
high-risk actions. Tenant membership не даёт platform access. Sensitive
actions требуют reason, explicit confirmation, idempotency и immutable audit
record; destructive/bulk operations имеют dry-run/estimate, bounds и
separation-of-duties там, где это необходимо.

Admin responses `no-store/noindex`; BFF не принимает произвольный upstream
URL и не пересылает internal service tokens. Error output и audit metadata не
содержат auth/payment/provider secrets или лишние PII.

Обычное истечение короткой access session не возвращает администратора на
форму входа: `/admin/api/**` выполняет ту же координированную refresh-ротацию,
что `/app`, повторяет исходный запрос один раз и для mutation подставляет новый
CSRF token. Повторная аутентификация требуется только когда refresh session
действительно истекла, отозвана либо high-risk операция явно требует recent
authentication/MFA.

Текущий раздел admin хранится в query-параметре `screen`. Экран операций
дополнительно фиксирует `status`, `type`, интервал автообновления `refresh`
(фиксированные 5 секунд) и выбранный `operation` UUID. Reload и
прямая ссылка восстанавливают тот же список и drawer; операция загружается по
отдельному bounded GET по ID и не обязана находиться на первой cursor-странице.
Все разделы автоматически обновляются каждые 5 секунд без параллельных
перекрывающихся запросов; запоздавший ответ старого запроса не заменяет
результат нового фильтра. Старая ссылка с другим `refresh` нормализуется до 5.
Каждый экран имеет один заголовок в общей шапке без повторного описания и
кнопки обновления. Создание сущности вызывается справа в шапке и открывает
модалку; настройки также открываются в модалке, подробности — в правой панели.
Ручное выключение, плавная остановка и удаление воркера требуют modal
confirmation; до подтверждения запрос не отправляется. Удаление скрывает
узел и отзывает его ключ, но сохраняет результаты и историю операций.
Строка rank-операции сразу показывает поисковую систему, безопасную подпись
подключения (название и маска без API-ключа) и актуальные активные
назначения основного или удалённых воркеров; не применимые к типу операции
поля показывают пустое состояние, а не выдуманный источник.
Технические задания проверки подключений не входят в журнал операций и его
сводные счётчики; статус ключа остаётся виден на экране интеграций.
Переход в другой раздел очищает operation-only параметры, а браузерная история
сохраняет открытие detail. Обычные GET/HEAD и ежедневные администраторские
настройки требуют действующую MFA-backed rotating cookie session, но не короткое
recent-auth окно. Повторная аутентификация применяется только к явно помеченным
high-risk командам (например, изменению ролей, финансовым подтверждениям и
грантам), а не ко всем mutation по признаку HTTP-метода. Каждая обычная
мутация по-прежнему проверяет platform role, CSRF, confirmation, причину и audit.

### 6.1. Продуктовая аналитика

Раздел `/admin?screen=analytics` содержит аудиторию (DAU/WAU/MAU и активные
области/проекты), время и использование функций, активацию новой registration
когорты, зрелые D1/D7/D30 и недельные когорты, исходы/скорость операций, финансы
и качество интерфейса. По умолчанию выбран период 30 дней и исключены staff/
test accounts; период 7/30/90, сегмент и вкладка восстанавливаются из URL.
Историческое покрытие явно показано. UTC-дни и distinct user counts общие
для графиков и KPI; фоновые опросы, воркеры и расписания не создают DAU.

Аналитика доступна platform ролям ANALYST/OPERATIONS/SUPPORT/FINANCE и
SUPER_ADMIN с действующей MFA-backed сессией. Только FINANCE/SUPER_ADMIN
получают финансовый раздел; query не может расширить финансовые права.
Отчёт кешируется пять минут и читается UI раз в минуту без перекрывающихся
запросов. Графики имеют легенду, значения, табличное представление и CSV
суточной активности. Loading, empty, error и degraded sources не скрываются.
Источники данных и определения — ADR-2026-057.

## 7. Контентная модель

Типизированный public content содержит:

- stable id, locale, slug и status;
- title, description, blocks и media metadata;
- canonical/hreflang/robots/JSON-LD fields;
- author/reviewer и publish/update timestamps;
- redirect source/target/status;
- legal/marketing version identifiers.

Build/test отклоняет duplicate locale+slug, broken internal links, missing
canonical/hreflang, invalid redirect cycles и запрещённый indexing private
routes. Rich content проходит allowlist sanitization; untrusted HTML/scripts
не исполняются.

Pricing и integration technical availability авторитетно приходят из Core
catalog/capability registry. Marketing copy не может менять entitlement,
provider routing или billable price без backend version.

## 8. Performance и caching

- public static content может использовать CDN/revalidation;
- personalized `/app` и `/admin` не кэшируются shared cache;
- anonymous tool metadata кэшируется отдельно от run result;
- browser bundles не содержат server clients/secrets;
- route-level budgets контролируют JS, images, fonts, LCP/INP/CLS;
- third-party scripts загружаются по consent/allowlist и не блокируют critical
  rendering path.

## 9. Accessibility и localization

UI соответствует WCAG 2.2 AA: keyboard flow, visible focus, semantic labels,
dialog/focus trapping, error association, reduced motion и достаточный
contrast. Locale влияет на форматирование, но identifiers/API contracts
остаются locale-independent. Отсутствующий перевод не создаёт битую страницу
и фиксируется telemetry/test.

## 10. Security headers

Public/private/admin route groups имеют отдельные CSP/cache/robots policies.
Обязательны frame protection, MIME sniffing protection, referrer/permissions
policy; HSTS включается только за доверенным HTTPS proxy. Cookies имеют
HttpOnly/Secure/SameSite и bounded scope. CSRF проверяется backend-ом для
state-changing cookie-authenticated requests.

## 11. Acceptance

- один frontend artifact обслуживает public, `/app` и `/admin`;
- private/admin routes невозможно проиндексировать или закэшировать публично;
- BFF не расширяет API surface и не раскрывает cookies/secrets;
- permission boundary проверяется backend-ом для каждого tenant/admin action;
- content/link/SEO/localization tests проходят без внешнего CMS;
- public Toolbox и project tools используют общие contracts/capabilities;
- loading/empty/error/degraded/forbidden/conflict states покрыты;
- production build не содержит dead admin package или отдельный admin server.

## Файлы проектных заметок

Заметки остаются SEO-owned текстовыми файлами. При создании пользователь
выбирает Markdown (.md), текст (.txt), CSV, TSV или JSON; прежние заметки
сохраняют Markdown. CSV/TSV редактируются как строки и колонки, поддерживают
вставку диапазона и read-only предпросмотр. Формат и содержимое сохраняются
через существующий tenant-scoped API с optimistic version check. Общая
публичная страница использует тот же безопасный preview, `no-store`/`noindex`
и отзыв непрозрачного токена при закрытии доступа. Загрузка и скачивание
текстовых файлов не создают отдельный storage owner или внешний сервис.

### Общая история фоновых операций

В `/admin` проектный журнал включает импорт семантики наряду с обходом,
позициями, частотностями, ИИ, кластеризацией, подбором и экспортом. Источники
истины остаются в Jobs DB: обычные Jobs и самостоятельные semantic imports.
Список, cursor pagination, фильтры, счётчики и detail читают обе истории.
Admin cancel использует штатный owning workflow и сохраняет Core audit.
Доступные зарегистрированные воркеры получают подходящие шаги Gateway;
выделенные фоновые процессы основного сервера разрешены как резерв.
HTTP-процессы создают команды и читают состояние, не выполняя обход или
разбор/публикацию файлов.
