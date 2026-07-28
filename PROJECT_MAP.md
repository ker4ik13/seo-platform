# Карта проекта

Последнее обновление: 28 июля 2026 года

Текущий инкремент: Semantics import → Upload inspection
Статус: resumable S3 upload и обязательный inspection worker реализованы;
parser/staging следующие

Этот файл является короткой оперативной картой. Полные требования находятся в [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).

## 1. Инварианты

- Tenant: `workspace`; проект всегда принадлежит одному workspace.
- Backend-контуры: platform API, SEO data, jobs/integrations, realtime.
- Каждый backend владеет своей PostgreSQL database.
- Межсервисные IDs — UUIDv7; cross-database foreign keys запрещены.
- Синхронные связи — internal HTTP; надёжные события — NATS JetStream + outbox/inbox.
- Долгие операции — BullMQ/Redis.
- Большие файлы — S3-compatible object storage.
- Email подключается через port/adapter и может быть выключен.
- Frontend не обращается к domain services напрямую: публичный вход — platform API.
- Platform-paid SEO API запрещён без price book, budget и коммерческого права.
- Основной домен обслуживает единый `platform-web`; `/app` private/noindex.
- Public/project Toolbox и API используют один capability registry.
- Billing никогда автоматически не удаляет проекты и не скрывает историю.
- Чек НПД создаётся только для verified успешного платежа ЮKassa.
- Настройки каналов уведомлений принадлежат профилю пользователя; проектные
  подписки задают типы работ и могут только сужать/переопределять профиль.

## 2. Development workspace

Корневая папка координирует локальную разработку. Каждый `platform-*` каталог является независимой deployable/repository boundary и в дальнейшем может быть вынесен в отдельный Git-репозиторий.

| Каталог | Ответственность | Deployable |
|---|---|---|
| `platform-contracts` | HTTP/event/error contracts без бизнес-логики | npm package |
| `platform-api` | auth, workspace, project, billing, API gateway | да |
| `platform-seo-data` | semantics, pages, positions, competitors | да |
| `platform-jobs-integrations` | jobs, workers, connectors, S3/email ports | несколько entrypoints |
| `platform-realtime` | WebSocket presence/collaboration delivery | да |
| `platform-web` | public site, Toolbox, API docs и приложение `/app` | да |
| `platform-admin` | внутренняя административная панель | да |
| `platform-infrastructure` | Compose/Dokploy, monitoring, runbooks | конфигурация |
| `docs/technical-spec` | нормативное ТЗ | нет |
| `semaflow-seo-platform-design` | исходный статический дизайн-прототип | нет |

## 3. Текущие связи

```text
platform-web ──────┐
platform-admin ────┼──> platform-api
                               │
                               ├──> platform-seo-data
                               ├──> platform-jobs-integrations
                               └──> platform-realtime

all backend services <──> NATS
jobs/realtime <──> Redis
jobs <──> S3
upload inspection worker ──> ClamAV
platform-web public/docs <──> Directus
```

Platform API синхронно передаёт upload-команды в jobs-integrations через
internal HTTP с отдельным shared token и проверенным tenant/actor context.
Остальная межсервисная бизнес-коммуникация пока не включена: подключены
transport и health/readiness, таблицы outbox/inbox созданы. Durable публикация
событий начинается в следующем вертикальном срезе.

## 4. Порты по умолчанию

| Компонент | Порт |
|---|---:|
| unified web | 3000 |
| admin | 3002 |
| platform-api | 4000 |
| seo-data | 4001 |
| jobs-integrations API | 4002 |
| realtime | 4003 |
| Directus | 8055 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS client/monitor | 4222 / 8222 |
| ClamAV `clamd` (только internal network) | 3310 |

## 5. Конфигурация

- Корневой `.env.example` документирует remote compose variables.
- Каждый сервис имеет собственный `.env.example`.
- Runtime validation должна завершать startup при отсутствии обязательной переменной.
- `S3_ENABLED=false` и `EMAIL_ENABLED=false` разрешены до подключения провайдеров.
- Имена access/session/CSRF cookies в `platform-web` и `platform-api` обязаны
  совпадать; публичным для JavaScript является только имя CSRF cookie.
- Directus использует local media volume до переключения
  `DIRECTUS_STORAGE_DRIVER=s3`; application uploads сразу имеют S3 adapter.
- Production secrets задаются только в Dokploy.
- `inspection` Compose profile запускает отдельные ClamAV и upload inspection
  worker; без доступного scanner файл fail-closed остаётся `UPLOADED`.

## 6. Внутренняя структура пакетов

Backend convention:

- `src/config` — единственная точка чтения и проверки env;
- `src/database` + `prisma` — Prisma adapter, schema и migrations владельца БД;
- `src/messaging` — NATS transport; domain code не импортирует transport напрямую;
- `src/health` — liveness/readiness;
- `src/system` — временный descriptor возможностей;
- `src/generated` и `dist` — генерируемые, не редактируются вручную.

Специализированные модули:

- `platform-api/src/identity` — account/session lifecycle и CSRF guards;
- `platform-api/src/identity/mfa.*`, `totp.*` — TOTP lifecycle, login
  challenge и recovery codes;
- `platform-api/src/authorization` — default-deny permission catalog и
  проверка tenant context;
- `platform-api/src/tenants` — workspace/project commands и queries;
- `platform-api/src/tenants/team.*` — приглашения, участники и проектные
  ограничения доступа;
- `platform-api/src/uploads` — project-scoped public upload commands и
  доверенный client к jobs-integrations;
- `platform-api/src/audit`, `src/outbox` — переиспользуемые transactional
  записи аудита и событий;
- `platform-jobs-integrations/src/queue` — BullMQ connection, system queue и
  идемпотентная `upload-inspection` queue;
- `platform-jobs-integrations/src/storage` — S3 port, disabled и S3 adapters;
- `platform-jobs-integrations/src/malware` — scanner port, disabled adapter и
  потоковый `clamd` INSTREAM adapter;
- `platform-jobs-integrations/src/internal` — fail-closed авторизация
  внутренних HTTP-команд;
- `platform-jobs-integrations/src/uploads` — multipart lifecycle, opaque
  object keys, size verification, lease/heartbeat inspection и upload outbox
  events;
- `platform-jobs-integrations/src/email` — email port, disabled и SMTP adapters;
- `platform-realtime/src/realtime` — Socket.IO gateway и Redis adapter;
- `platform-web/app` — public, tools, docs и private `/app` App Router screens;
- `platform-web/app/app/api` — same-origin browser BFF только к
  `/api/v1` Platform API;
- `platform-web/lib/protected-app.ts` — server-side session gate и безопасный
  refresh redirect;
- `platform-*/lib` и `components` — adapters и переиспользуемые UI-части;
- `platform-infrastructure/docker` — reusable backend/web images;
- `platform-infrastructure/postgres/init` — создание service databases.

Entrypoints:

- API/SEO/realtime/jobs HTTP: `src/main.ts`;
- system worker: `platform-jobs-integrations/src/worker.main.ts`;
- upload inspection worker:
  `platform-jobs-integrations/src/inspection-worker.main.ts`;
- Next.js: App Router соответствующего frontend-пакета;
- remote stack: `platform-infrastructure/compose.dokploy.yml`.

## 7. Статус модулей

Легенда: `planned` → `foundation` → `vertical slice` → `production-ready`.

| Модуль | Статус |
|---|---|
| Contracts | foundation |
| Service health/readiness | foundation |
| Prisma schemas | foundation |
| NATS/Redis wiring | foundation |
| S3/email ports | foundation |
| Realtime public gateway | foundation |
| Unified Web/private app shell | vertical slice |
| Admin shell | vertical slice |
| Auth core | vertical slice |
| Workspaces/projects/team access | vertical slice |
| Semantics/import | vertical slice: upload + inspection |
| Rankings/integrations | planned |
| Billing/YooKassa | planned |
| Directus content | planned |

Foundation содержит четыре валидные Prisma schemas и начальные migrations,
health/readiness, Redis/BullMQ, NATS transport, S3/SMTP adapters, fail-closed
WebSocket gateway, unified web/admin shell и Dokploy Compose.

Identity core содержит регистрацию email/password, consent snapshots,
Argon2id, email verification, одноразовое password recovery с отзывом прежних
сессий, TOTP/recovery codes с зашифрованными secrets и короткоживущим login
challenge, короткую access cookie, rotation refresh cookie, CSRF, session
inventory/revocation, PostgreSQL rate limit, audit и outbox.

Tenant core содержит workspace/project CRUD, системную RBAC-матрицу,
одноразовые workspace invitations, optimistic locking участников и
`project_member_access`. Проектное назначение только сужает workspace role;
`NONE` и отсутствие назначения при `all_projects=false` скрывают проект.

Private Web содержит same-origin BFF, регистрацию/вход/подтверждение email,
запрос и установку нового пароля, refresh/logout, session gate, создание и
выбор workspace/project, MFA challenge и экран безопасности профиля. До
появления SEO-данных dashboard показывает empty states, а не демонстрационные
значения.

Первый import slice содержит публичные project upload endpoints, внутренний
multipart lifecycle в jobs database, прямую browser → S3 загрузку частей,
resume через `sessionStorage`, retry/cancel, обязательную проверку полного
набора частей и фактического размера. `upload.completed.v1` означает только
статус `UPLOADED`; использовать объект для импорта можно лишь после inspection
worker и статуса `READY`.

Inspection worker читает S3 строго потоком, удерживает восстанавливаемый
lease/heartbeat, считает фактический SHA-256 и размер, проверяет сигнатуру
контейнера/MIME и передаёт весь поток в ClamAV. Scanner работает fail-closed:
его недоступность возвращает запись в `UPLOADED` для retry, а не разрешает
импорт. Итог фиксируется событиями `upload.ready.v1` или
`upload.rejected.v1`; rejected-объект не получает download/import access.
Web после multipart completion опрашивает project-scoped status endpoint,
показывает scanning/ready/rejected и позволяет отдельно обновить долгую
проверку, не создавая повторную загрузку.

## 8. Проверенное состояние

- Prisma Client generation: pass для 4 сервисов.
- Prisma schema validation: pass для 4 сервисов.
- TypeScript strict typecheck: pass для 8 пакетов.
- Platform API unit tests: 42 pass, 0 fail.
- Jobs/integrations unit tests: 18 pass, 0 fail.
- Contracts unit tests: 1 pass, 0 fail.
- Unified Web security helper tests: 2 pass, 0 fail.
- NestJS production build: pass для 4 сервисов.
- Unified Next.js production build: pass; проверены public site, Toolbox,
  API docs и private `/app`.
- Compose config: pass с `.env.example`.
- Visual QA: 1440, 1024 и 390 px; horizontal overflow не найден.
- Semantics upload browser QA: 1280 px, runtime errors и horizontal overflow
  не найдены; устранён CSS conflict публичного `.brand` с app shell.
- Target runtime: Node.js 24. Локальная проверка выполнялась на Node.js 22 с
  ожидаемым engine warning; контейнеры используют Node.js 24.

## 9. Следующий вертикальный срез

`import job → streaming parser → semantic staging → preview → publish version`

OAuth/OIDC выполняется после подтверждения зависимости `jose`; QR для TOTP —
после подтверждения `qrcode`.

## 10. Незавершённые риски

- Дашборд использует честные empty states до первого SEO domain slice.
- Realtime не допускает вход в project rooms до общей token/permission проверки.
- Durable outbox/inbox publisher и consumers ещё не реализованы.
- Для rejected/quarantine objects ещё требуется production lifecycle policy и
  отдельный reconciliation/cleanup job; выдача и импорт таких объектов
  запрещены уже сейчас.
- ClamAV требует отдельного memory/capacity budget на VPS; concurrency
  inspection worker ограничивается независимо от API.
- Bucket требует внешней CORS/lifecycle настройки: Web origin, exposed `ETag`,
  abort incomplete multipart через 2 дня.
- Нет production observability, backup/restore и secret rotation runbooks.
- Directus collection schema и seed появятся вместе с CMS vertical slice.
- Email-verification consumer ожидает подключения
  `@nats-io/jetstream`; plaintext verification token не логируется.
- QR для TOTP пока представлен локальным `otpauth://` URI и ручным ключом;
  UI QR появится после подтверждения зависимости `qrcode`.
- SEO connectors, тарификация и YooKassa пока присутствуют только в ТЗ/схемах.
- `platform-app` сохранён как legacy Git-источник до проверки переноса; новая
  функциональность добавляется только в `platform-web`.

## 11. Правило обновления карты

Добавлять только информацию, необходимую следующему разработчику:

- новая граница;
- новый entrypoint;
- новая очередь/event;
- новая база/таблица;
- новый обязательный env;
- изменившийся startup/data flow;
- текущий незавершённый риск.

Детальные поля и UX не копировать сюда — давать ссылку на ТЗ или README сервиса.
