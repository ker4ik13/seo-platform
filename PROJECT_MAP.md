# Карта проекта

Последнее обновление: 28 июля 2026 года  
Текущий инкремент: Foundation M1  
Статус: завершён и проверен; следующий срез — Identity/Workspace/Project

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

## 2. Development workspace

Корневая папка координирует локальную разработку. Каждый `platform-*` каталог является независимой deployable/repository boundary и в дальнейшем может быть вынесен в отдельный Git-репозиторий.

| Каталог | Ответственность | Deployable |
|---|---|---|
| `platform-contracts` | HTTP/event/error contracts без бизнес-логики | npm package |
| `platform-api` | auth, workspace, project, billing, API gateway | да |
| `platform-seo-data` | semantics, pages, positions, competitors | да |
| `platform-jobs-integrations` | jobs, workers, connectors, S3/email ports | несколько entrypoints |
| `platform-realtime` | WebSocket presence/collaboration delivery | да |
| `platform-app` | основное пользовательское приложение | да |
| `platform-admin` | внутренняя административная панель | да |
| `platform-marketing` | маркетинговый сайт и Directus client | да |
| `platform-infrastructure` | Compose/Dokploy, monitoring, runbooks | конфигурация |
| `docs/technical-spec` | нормативное ТЗ | нет |
| `semaflow-seo-platform-design` | исходный статический дизайн-прототип | нет |

## 3. Текущие связи

```text
platform-app ───────┐
platform-admin ─────┼──> platform-api
platform-marketing ─┘          │
                               ├──> platform-seo-data
                               ├──> platform-jobs-integrations
                               └──> platform-realtime

all backend services <──> NATS
jobs/realtime <──> Redis
jobs <──> S3
marketing <──> Directus
```

Пока межсервисная бизнес-коммуникация не включена: подключены transport и
health/readiness, таблицы outbox/inbox созданы. Публикация событий начинается
в следующем вертикальном срезе.

## 4. Порты по умолчанию

| Компонент | Порт |
|---|---:|
| marketing | 3000 |
| app | 3001 |
| admin | 3002 |
| platform-api | 4000 |
| seo-data | 4001 |
| jobs-integrations API | 4002 |
| realtime | 4003 |
| Directus | 8055 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS client/monitor | 4222 / 8222 |

## 5. Конфигурация

- Корневой `.env.example` документирует remote compose variables.
- Каждый сервис имеет собственный `.env.example`.
- Runtime validation должна завершать startup при отсутствии обязательной переменной.
- `S3_ENABLED=false` и `EMAIL_ENABLED=false` разрешены до подключения провайдеров.
- Directus использует local media volume до переключения
  `DIRECTUS_STORAGE_DRIVER=s3`; application uploads сразу имеют S3 adapter.
- Production secrets задаются только в Dokploy.

## 6. Внутренняя структура пакетов

Backend convention:

- `src/config` — единственная точка чтения и проверки env;
- `src/database` + `prisma` — Prisma adapter, schema и migrations владельца БД;
- `src/messaging` — NATS transport; domain code не импортирует transport напрямую;
- `src/health` — liveness/readiness;
- `src/system` — временный descriptor возможностей;
- `src/generated` и `dist` — генерируемые, не редактируются вручную.

Специализированные модули:

- `platform-jobs-integrations/src/queue` — BullMQ connection и system queue;
- `platform-jobs-integrations/src/storage` — S3 port, disabled и S3 adapters;
- `platform-jobs-integrations/src/email` — email port, disabled и SMTP adapters;
- `platform-realtime/src/realtime` — Socket.IO gateway и Redis adapter;
- `platform-*/app` — Next.js App Router screens;
- `platform-*/lib` и `components` — adapters и переиспользуемые UI-части;
- `platform-infrastructure/docker` — reusable backend/web images;
- `platform-infrastructure/postgres/init` — создание service databases.

Entrypoints:

- API/SEO/realtime/jobs HTTP: `src/main.ts`;
- system worker: `platform-jobs-integrations/src/worker.main.ts`;
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
| App/Admin/Marketing shells | foundation |
| Auth/workspaces/projects | planned |
| Semantics/import | planned |
| Rankings/integrations | planned |
| Billing/YooKassa | planned |
| Directus content | planned |

Foundation содержит четыре валидные Prisma schemas и начальные migrations,
health/readiness, Redis/BullMQ, NATS transport, S3/SMTP adapters, fail-closed
WebSocket gateway, три адаптивных frontend shell и Dokploy Compose.

## 8. Проверенное состояние

- Prisma Client generation: pass для 4 сервисов.
- Prisma schema validation: pass для 4 сервисов.
- TypeScript strict typecheck: pass для 8 пакетов.
- Unit tests: 8 pass, 0 fail.
- NestJS production build: pass для 4 сервисов.
- Next.js production build: pass для app/admin/marketing.
- Compose config: pass с `.env.example`.
- Visual QA: 1440, 1024 и 390 px; horizontal overflow не найден.
- Target runtime: Node.js 24. Локальная проверка выполнялась на Node.js 22 с
  ожидаемым engine warning; контейнеры используют Node.js 24.

## 9. Следующий вертикальный срез

`registration → workspace → project → permission check → audit event`

После него:

`multipart S3 upload → import job → semantic staging → publish version`.

## 10. Незавершённые риски

- Дашборды используют демонстрационные данные до первого domain slice.
- Realtime не допускает вход в project rooms до общей token/permission проверки.
- Outbox/inbox publisher и consumer ещё не реализованы.
- Нет production observability, backup/restore и secret rotation runbooks.
- Directus collection schema и seed появятся вместе с CMS vertical slice.
- SEO connectors, тарификация и YooKassa пока присутствуют только в ТЗ/схемах.

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
