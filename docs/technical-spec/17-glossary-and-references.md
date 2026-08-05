# Глоссарий, решения и официальные источники

## 1. Глоссарий продукта

### Account / аккаунт

Глобальная пользовательская учётная запись. Один пользователь может состоять в нескольких рабочих областях.

### Workspace / рабочая область

Tenant и единица командного управления, биллинга, участников, ролей, credentials и лимитов.

### Project / проект

SEO-контекст одного сайта, домена или направления внутри workspace.

### Client mode

Ограниченный интерфейс для клиента агентства без внутренних заметок, credentials, себестоимости и технической кухни.

### Guest report

Снимок отчёта, доступный по ограниченной ссылке без полноценного аккаунта.

### White label

Логотип, название и цвета агентства в отчёте. В этой версии не включает собственный домен.

### Semantic core / семантическое ядро

Набор поисковых запросов и связанных с ними групп, кластеров, частотностей, позиций, интентов, страниц и пользовательских данных.

### Keyword

Нормализуемый поисковый запрос. Исходная и нормализованная формы хранятся раздельно, если нормализация изменяет текст.

### Keyword group

Ручная иерархическая организация запросов. Один запрос может поддерживать одно или несколько membership согласно настройке модели проекта.

### Cluster

Алгоритмически или вручную сформированная группа запросов, обычно основанная на пересечении результатов поиска и/или смысловой близости.

### Tracking context

Комбинация поисковой системы, региона, языка, устройства, глубины и дополнительных параметров, в которой снимаются позиции.

### Position snapshot

Неизменяемое наблюдение позиции keyword/domain/URL на конкретный момент и в tracking context.

### Current position

Материализованное последнее релевантное наблюдение для быстрого чтения. Источником истории остаются snapshots.

### Frequency snapshot

Неизменяемое значение частотности с типом, регионом, источником и датой получения.

### SERP snapshot

Сохранённый нормализованный состав поисковой выдачи и, при разрешении, ссылка на raw provider payload.

### Data provenance

Происхождение значения: provider, credential mode, method, region, device, collected time, transformation/version.

### Freshness

Возраст данных относительно настроенного допустимого интервала.

### BYOK

Bring Your Own Key: пользователь хранит в платформе собственный ключ SEO API и оплачивает provider напрямую.

### Platform key

Credential, принадлежащий оператору платформы. Пользователь платит платформе по тарифу/балансу и опубликованной цене.

### Integration binding

Настройка, связывающая provider/capability с workspace или project, credential mode, приоритетом, лимитами и fallback.

### Capability

Нормализованная функция provider: получение SERP, позиций, Wordstat, частотности, подсказок, кластеризация и т. п.

### Fallback

Разрешённый переход на другой credential/provider при определённом классе ошибки и в пределах cost ceiling.

### Job

Долгая асинхронная операция с жизненным циклом, progress, стоимостью, результатом и ошибками.

### Job item/chunk

Повторяемая часть большой job, позволяющая возобновление, частичный результат и ограниченные retries.

### Automation

Версионируемое правило запуска действий по расписанию или событию с бюджетом, уведомлениями и условиями.

### Idempotency

Свойство повторного запроса/события не создавать дополнительного бизнес-эффекта.

### Reservation

Временная блокировка суммы или allowance перед платной операцией.

### Settlement

Фиксация фактической стоимости после выполнения операции.

### Ledger

Неизменяемый двойной журнал движений средств/кредитов. Текущий баланс является следствием записей, а не произвольно редактируемым числом.

### Entitlement

Право workspace использовать функцию или объём на основании тарифа, add-on или явного override.

### Price book

Версионированный набор пользовательских цен на provider capability с единицами, валютой и сроком действия.

### Presence

Эфемерная информация о пользователях, находящихся в одном проекте/представлении/документе.

### Cell selection

Эфемерное выделение диапазона таблицы другим пользователем; не является блокировкой данных.

### OCC

Optimistic concurrency control: изменение принимается только при совпадении ожидаемой версии.

### CRDT

Структура совместного редактирования, способная сливать параллельные изменения. Применяется к документам, а не ко всем доменным таблицам.

### Dashboard

Настраиваемая композиция виджетов, показывающая актуальные данные проекта.

### Report definition

Настройка состава и оформления отчёта.

### Report snapshot

Неизменяемый опубликованный результат отчёта на определённый момент.

### Page map

Связь query → cluster → target page с сигналами пропущенных страниц и каннибализации.

### Cannibalization

Ситуация, когда несколько страниц конкурируют за один запрос/кластер либо целевая и фактическая URL расходятся.

### Public content source

Типизированный versioned source маркетингового сайта. Не является источником
прав, billing или runtime-конфигурации приложения.

### App admin

Собственная административная панель для пользователей, workspaces, projects, jobs, providers, billing, audit и эксплуатации.

## 2. Технический глоссарий

### ADR

Architecture Decision Record — документированное архитектурное решение с причиной и последствиями.

### API contract

Машиночитаемая схема запросов/ответов/ошибок и правил совместимости.

### Transactional outbox

Событие сначала фиксируется в базе в одной транзакции с domain change, затем надёжно публикуется.

### Inbox

Журнал обработанных event IDs у consumer, предотвращающий повторный бизнес-эффект.

### At-least-once delivery

Гарантия, при которой событие может быть доставлено повторно. Требует идемпотентного consumer.

### DLQ

Dead-letter queue/stream для сообщений, не обработанных после ограниченных retries.

### RPO

Максимально допустимая потеря данных по времени при аварии.

### RTO

Целевое время восстановления сервиса.

### SLI/SLO

Измеритель и целевой уровень надёжности.

### PITR

Point-in-time recovery PostgreSQL из base backup и WAL.

### UUIDv7

Временнó упорядоченный UUID, удобный для распределённой генерации и индексов по сравнению со случайным UUIDv4.

### Partitioning

Разделение большой логической таблицы истории на физические partitions по времени/ключу.

### Expand–migrate–contract

Совместимый процесс изменения схемы: добавить новую структуру, перенести данные/переключить код, затем удалить старую.

### BFF

Backend for frontend. Отдельный BFF не вводится на старте; platform API предоставляет UI-ориентированные агрегирующие endpoints там, где это оправдано.

### Object storage / S3

Хранилище больших файлов отдельно от диска приложения и PostgreSQL: импортов до 5 GB, экспортов, raw SERP, PDF-отчётов, вложений и аватаров. Приложение обращается к объекту по ключу и выдаёт временную подписанную ссылку. Рекомендуемый первый production provider — Yandex Object Storage.

### Transactional email

Сервис доставки обязательных писем приложения: подтверждение email, восстановление пароля, приглашение в workspace, уведомление о счёте, ошибке задания или готовности отчёта. Это не рекламная рассылка. Рекомендуемый первый transport — Unisender Go через API/SMTP.

### Monitoring/observability stack

Набор систем, позволяющий видеть состояние production: Prometheus собирает метрики, Loki — логи, Tempo — трассировки запросов между сервисами, Grafana показывает dashboards и alerts, OpenTelemetry/Alloy доставляют telemetry. На раннем этапе Tempo может подключаться после базовых метрик и логов.

## 3. Реестр зафиксированных архитектурных решений

| ID | Решение | Статус |
|---|---|---|
| ADR-2026-001 | Международный продукт, первые локали `en` и `ru` | принято |
| ADR-2026-002 | Main domain для сайта, отдельные generic subdomains для приложения и систем | заменено ADR-2026-027 |
| ADR-2026-003 | Next.js/React/TypeScript для web-приложений | принято |
| ADR-2026-004 | NestJS для backend | принято |
| ADR-2026-005 | Self-hosted PostgreSQL 18 и Prisma | принято |
| ADR-2026-006 | VPS + Dokploy | принято |
| ADR-2026-007 | Четыре backend-контура вместо чрезмерного дробления | принято |
| ADR-2026-008 | Redis + BullMQ для jobs | принято |
| ADR-2026-009 | NATS JetStream + outbox/inbox для надёжных событий | рекомендуется ТЗ |
| ADR-2026-010 | Socket.IO + Redis adapter для presence/UI realtime | принято по рекомендации |
| ADR-2026-011 | Yjs/Hocuspocus для совместных документов | рекомендуется ТЗ |
| ADR-2026-012 | Directus только для публичного web-контента | заменено ADR-2026-041 |
| ADR-2026-013 | Собственная app-admin | заменено единым frontend по ADR-2026-041 |
| ADR-2026-014 | Subscription + included limits + balance/add-ons | принято |
| ADR-2026-015 | BYOK и platform credentials | принято |
| ADR-2026-016 | Key Collector через exports, с сохранением mapping/values | принято |
| ADR-2026-017 | Client/guest/white label, без custom domains | принято |
| ADR-2026-018 | Email, Google, Яндекс, Telegram auth | принято |
| ADR-2026-019 | Отдельные databases per service boundary в одном cluster на старте | рекомендуется ТЗ |
| ADR-2026-020 | S3-compatible object storage для больших файлов/raw data | рекомендуется ТЗ |
| ADR-2026-021 | Оператор первого этапа зарегистрирован в Российской Федерации | принято |
| ADR-2026-022 | Первый payment adapter — ЮKassa, международный adapter добавляется позднее | принято |
| ADR-2026-023 | Первые SEO-коннекторы — XMLStock, Arsenkin Tools и Keys.so | принято |
| ADR-2026-024 | Подписка отделена от prepaid data balance | принято |
| ADR-2026-025 | Стартовые планы: Trial, Solo, Team, Agency, Business, Enterprise | рекомендуется ТЗ |
| ADR-2026-026 | Keys.so platform-paid запрещён до отдельного коммерческого соглашения | обязательно по текущим публичным условиям |
| ADR-2026-027 | Единый Web: публичный сайт и Toolbox на `/`, приложение на `/app` | принято |
| ADR-2026-028 | API docs публикуются на `/docs/api`; machine API остаётся на техническом поддомене | принято |
| ADR-2026-029 | Базовый API всех SEO-инструментов включён во все платные тарифы | принято |
| ADR-2026-030 | Billing ограничивает новые операции, но не чтение; проекты не удаляются автоматически | принято |
| ADR-2026-031 | Агрегированная история долговременная, raw SERP имеет отдельный retention | принято |
| ADR-2026-032 | Public и project Toolbox используют общий capability registry и jobs | принято |
| ADR-2026-033 | Tracking context хранит versioned search configuration; provider и schedule принадлежат connector/automation | принято |
| ADR-2026-040 | Модульный Core и изолированный Execution | принято |
| ADR-2026-041 | Три application deployables, единый frontend и удаление неиспользуемого CMS | принято |

Новые формальные ADR-файлы хранятся в `docs/adr`; прежние решения из реестра
переносятся туда при первом существенном изменении соответствующей границы.

## 4. Почему не создаются десятки микросервисов

Целевая декомпозиция содержит один frontend и два backend-компонента:

1. `frontend`;
2. `backend-core` с API/SEO/Realtime modules;
3. `backend-execution` с worker roles.

Такое разделение:

- отделяет учётные/финансовые транзакции от тяжёлых SEO-данных;
- позволяет независимо масштабировать workers и WebSocket;
- ограничивает blast radius provider integrations;
- не требует от небольшой команды сопровождать десятки deployable units;
- допускает дальнейшее выделение только по измеренной нагрузке или организационной границе.

Выделение нового сервиса допускается, если одновременно есть несколько причин:

- независимый профиль масштабирования;
- отдельная модель отказа/безопасности;
- ясный owner;
- стабильный контракт;
- измеримая проблема текущего deployment;
- выгода выше стоимости дополнительной эксплуатации.

## 5. Неопределённости, не блокирующие P0

### 5.1. Бренд и домен

Нужно выбрать до публичной настройки DNS, OAuth redirect URI и email domain. В коде и ТЗ используются placeholders.

### 5.2. Второй платёжный провайдер

Россия и ЮKassa зафиксированы. До активного международного продвижения нужно выбрать второй payment adapter или Merchant of Record, принимающий платежи в нужных странах и способный заключить договор с доступной юридической структурой. ЮKassa по умолчанию не покрывает глобальные карточные платежи.

### 5.3. Коммерческие договоры SEO-провайдеров

XMLStock, Arsenkin Tools и Keys.so выбраны первыми. До platform-paid режима нужно письменно подтвердить:

- допустимость использования общего provider account;
- право показывать и хранить результаты для клиентов платформы;
- тарификацию и лимиты;
- атрибуцию;
- возвраты/ошибки;
- технические rate limits.

Keys.so в первом релизе работает только как BYOK: текущие публичные условия запрещают перепродажу и предоставление доступа к полученным данным.

### 5.4. Object storage

Рекомендуемый production default — Yandex Object Storage с S3 API. MinIO используется локально или как дополнительный компонент, но хранить единственную копию больших файлов на application VPS не следует.

### 5.5. Email и Telegram delivery

Рекомендуемый первый transactional email transport — Unisender Go. Нужно создать Telegram bot для auth/notifications. Adapter abstraction позволяет заменить поставщика.

### 5.6. Observability stack

Рекомендуемый старт: OpenTelemetry, Grafana Alloy, Prometheus, Grafana, Loki и независимый uptime check. Tempo и Sentry-compatible error tracking подключаются по мере появления нескольких production backend flows. Финальная конфигурация фиксируется P0 ADR с учётом RAM VPS и операционной нагрузки.

### 5.7. Масштаб custom columns

Нужен P0 benchmark для JSONB/typed value tables/materialized columns. Пользовательский UX задан, но физическая оптимизация выбирается по реальным query patterns.

### 5.8. Политика хранения raw SERP

Нужно согласовать срок, provider terms и стоимость storage. Parsed history и raw response имеют разные retention.

## 6. Рекомендуемые решения по открытым вопросам

- Начать с одного региона, но не зашивать регион в ID, URL и бизнес-логику.
- Для российского checkout вести RUB price book; международные USD/EUR price books публиковать отдельно после подключения соответствующего payment adapter, без автоматического пересчёта витринной цены.
- Не обещать unlimited usage.
- Сначала BYOK, затем platform keys после готовности ledger.
- Не реализовывать custom roles раньше проверки predefined roles на пилотах.
- Не строить Kubernetes до появления измеренной необходимости; Dokploy/Compose соответствует ранней стадии.
- Не хранить историю позиций как обновляемое поле keyword.
- Не использовать WebSocket как источник истины.
- Не применять CRDT ко всей semantic table.
- Не давать public content tooling доступ к application databases.
- Не делать AI обязательным для core workflows.

## 7. Официальные технические источники

Ссылки проверены при подготовке ТЗ 28 июля 2026 года. Перед реализацией конкретной версии зависимости документацию следует проверить повторно.

### 7.1. Frameworks и data

- [Next.js documentation](https://nextjs.org/docs)
- [NestJS documentation](https://docs.nestjs.com/)
- [NestJS WebSocket gateways](https://docs.nestjs.com/websockets/gateways)
- [NestJS WebSocket adapters и масштабирование Socket.IO](https://docs.nestjs.com/websockets/adapter)
- [PostgreSQL 18 documentation](https://www.postgresql.org/docs/18/)
- [Prisma: поддерживаемые базы и версии](https://www.prisma.io/docs/orm/core-concepts/supported-databases)
- [Prisma Migrate](https://docs.prisma.io/docs/orm/prisma-migrate)
- [Prisma transactions и optimistic concurrency control](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma multi-schema](https://docs.prisma.io/docs/orm/prisma-schema/data-model/multi-schema)

### 7.2. Jobs, events и collaboration

- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)
- [BullMQ rate limiting](https://docs.bullmq.io/guide/rate-limiting)
- [BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [NATS JetStream documentation](https://docs.nats.io/nats-concepts/jetstream)
- [Yjs awareness и presence](https://docs.yjs.dev/getting-started/adding-awareness)
- [Hocuspocus overview](https://tiptap.dev/docs/hocuspocus/getting-started/overview)
- [Tiptap collaborative editing guide](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing)

### 7.3. Deployment
- [Dokploy installation на VPS](https://docs.dokploy.com/docs/core/installation)
- [Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose/example)
- [Dokploy domains](https://docs.dokploy.com/docs/core/docker-compose/domains)
- [Dokploy remote servers](https://docs.dokploy.com/docs/core/remote-servers)
- [Dokploy cluster](https://docs.dokploy.com/docs/core/cluster)
- [Yandex Object Storage](https://yandex.cloud/ru/docs/storage/)
- [Yandex Object Storage S3 API](https://yandex.cloud/ru/docs/storage/s3/)

### 7.4. Авторизация и first-party analytics

- [Telegram Login / OIDC](https://core.telegram.org/bots/webapps)
- [Яндекс ID OAuth](https://yandex.ru/dev/id/doc/ru/access)
- [Google Search Console API](https://developers.google.com/webmaster-tools/v1/api_reference_index)
- [Google Analytics Data API](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [Яндекс Вебмастер API](https://yandex.ru/dev/webmaster/doc/ru/)
- [Яндекс Метрика API](https://yandex.ru/dev/metrika/)

### 7.5. SEO data providers

- [Yandex Wordstat API](https://yandex.ru/support2/wordstat/en/content/api-structure)
- [Keys.so OpenAPI](https://apidoc.keys.so/)
- [XMLRiver API](https://xmlriver.com/apidoc/api-about/)
- [XMLStock API/help](https://xmlstock.com/?do=api)
- [Arsenkin API](https://help.arsenkin.ru/api)
- [Arsenkin clustering API](https://help.arsenkin.ru/api/clustering-dev)
- [Arsenkin Tools: тарифы](https://arsenkin.ru/tariffs/)
- [Keys.so: тарифы](https://www.keys.so/ru/tarif)
- [Keys.so: условия использования](https://www.keys.so/ru/legal)
- [XMLStock: тарифы](https://xmlstock.com/?do=tariffs)
- [XMLStock: программа для разработчиков](https://xmlstock.com/?do=developers)

Условия использования, лимиты, форматы и возможность коммерческого перепредоставления результатов должны проверяться отдельно для каждого provider до включения platform-key mode.

### 7.6. Платежи и российская фискализация

- [ЮKassa: тарифы](https://yookassa.ru/docs/support/payments/fees)
- [ЮKassa: способы приёма платежей](https://yookassa.ru/docs/support/payments/accept-methods)
- [ЮKassa: автоплатежи](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/basics)
- [ЮKassa: API](https://yookassa.ru/developers/api)
- [ЮKassa: чеки для компаний, ИП и самозанятых](https://yookassa.ru/developers/payment-acceptance/receipts/basics)
- [ЮKassa: история изменений и прекращение сервиса чеков НПД 29.12.2025](https://yookassa.ru/developers/using-api/changelog)
- [ЮKassa: отправка чеков по 54-ФЗ](https://yookassa.ru/docs/support/merchant/payments/implement/online-sales-register)
- [ФНС: вопросы и ответы по НПД и информационному обмену](https://npd.nalog.ru/faq/)
- [ФНС: протокол информационного обмена с уполномоченными партнёрами](https://npd.nalog.ru/html/sites/www.npd.nalog.ru/infexch.pdf)
- [ФНС: формирование и передача чека НПД](https://www.nalog.gov.ru/rn53/news/activities_fts/14618624/)
- [ФНС: аннулирование и исправление чека НПД](https://www.nalog.gov.ru/rn08/news/activities_fts/16626196/)

### 7.7. Рыночные ориентиры

- [Rush Analytics: тарифы](https://www.rush-analytics.ru/pricing-plans)
- [Semrush: тарифы SEO Toolkit](https://www.semrush.com/pricing/#seo)
- [Ahrefs: тарифы](https://ahrefs.com/pricing)

Публичные цены используются только как ориентир позиционирования и проверяются перед изменением собственной тарифной сетки.

### 7.8. Transactional email и observability

- [Unisender Go: SMTP/API](https://www.unisender.com/ru/features/email/unisender-go-email-smtp-api/)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [Prometheus documentation](https://prometheus.io/docs/)
- [Grafana documentation](https://grafana.com/docs/grafana/latest/)
- [Grafana Loki](https://grafana.com/docs/loki/latest/)
- [Grafana Tempo](https://grafana.com/docs/tempo/latest/)

### 7.9. Стандарты и безопасность

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [AsyncAPI Specification](https://www.asyncapi.com/docs/reference/specification/latest)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

## 8. Документы, которые должны появиться в реализации

Помимо данного ТЗ:

- product requirement records;
- ADR;
- ERD по каждой базе;
- OpenAPI;
- AsyncAPI/event catalog;
- provider capability matrix;
- data classification/retention matrix;
- threat model;
- runbooks;
- incident policy;
- backup/DR plan;
- migration playbook;
- test strategy и test cases;
- design system;
- content model schema;
- analytics tracking plan;
- Terms/Privacy/DPA;
- public API/usage docs;
- release notes.

## 9. Порядок дальнейшей детализации

Рекомендуемый следующий шаг:

1. утвердить P0–P3 scope;
2. превратить P1 в sitemap/user flows;
3. подготовить ERD и OpenAPI для первого вертикального сценария;
4. собрать high-fidelity design;
5. выполнить нагрузочные prototypes;
6. оценить командой backlog;
7. только после gates начать production implementation.

Детализация не должна менять зафиксированные инварианты — tenant isolation, ledger, provenance, idempotency, history immutability и безопасное хранение credentials — без отдельного ADR.
