# Инфраструктура SEOньориты

Каталог содержит production-like Compose для Dokploy, Dockerfiles, настройки
PostgreSQL/Redis/NATS, security preflight, tests, monitoring и VPS runbooks.

## Прикладные сервисы

В `compose.dokploy.yml` ровно три long-running application service:

| Service | Artifact | Internal ports |
|---|---|---:|
| `frontend` | `@seo-platform/frontend` | 3000 |
| `backend-core` | `@seo-platform/backend-core` | 4000, 4001, 4003, 4004 |
| `backend-execution` | `@seo-platform/backend-execution` | 4002 |

PostgreSQL, два Redis instance, NATS и опциональный ClamAV — data/runtime
dependencies. Preflight, migrations и DB permission services выполняются один
раз перед стартом приложений. Подробная инструкция — в
[`DOKPLOY.md`](./DOKPLOY.md), полный production secret/S3/backup checklist —
в [`DOKPLOY-SECRETS.md`](./DOKPLOY-SECRETS.md).

Repository configs и startup scripts запекаются в versioned infrastructure
image stages. Постоянные данные используют named volumes
`postgres_data`, `redis_jobs_data`, `nats_data`, `clamav_data`; относительных
bind mounts на transient Dokploy checkout нет.

## Сети

- `edge` — frontend и публичные listeners Core;
- `internal` — backend/data traffic, без внешней публикации;
- `outbound` — только процессы, которым нужен внешний HTTP/S3/SMTP либо
  обновление ClamAV signatures;
- `jobs-redis` — Execution ↔ durable Redis/BullMQ;
- `realtime-redis` — Core Realtime ↔ Pub/Sub Redis.

Ports в Compose используются через `expose`, а не host `ports`. Публичные
domain routes создаются Dokploy/Traefik. PostgreSQL, Redis, NATS monitor,
ClamAV, Execution API и operational-alert receiver `4004` наружу не
публикуются.

## PostgreSQL и Prisma

До отдельного data cutover используются четыре compatibility databases:

- `platform_db` — Core API;
- `seo_db` — Core SEO;
- `realtime_db` — Core Realtime;
- `jobs_db` — Execution.

Для каждой базы migration owner отделён от runtime login. Startup flow:

1. cluster role/database bootstrap;
2. `prisma migrate deploy` owner-ролью;
3. exact runtime grants и cluster-wide audit;
4. старт application service.

`jobs_connector` не имеет direct table DML и работает через exact
`SECURITY DEFINER` broker functions. Rank и Web Push используют отдельные
runtime logins. Пароли не встраиваются в SQL и не выводятся в логи.

## Redis

- `redis-jobs`: AOF, `noeviction`, durable BullMQ, отдельный named user для
  HTTP/system/inspection/import/rank/crawl/connector roles;
- `redis-realtime`: ephemeral Socket.IO Pub/Sub с channel-only ACL.

Default user выключен. ACL рендерится в tmpfs, plaintext password не попадает
в Redis config/argv. Queue keys и Realtime channels имеют versioned namespace.

## NATS JetStream

NATS использует отдельные publisher/consumer/provisioner identities и exact
subject/API permissions. One-shot `nats-topology-provisioner` создаёт только
allowlisted streams/consumers и отклоняет несовместимый drift. Plaintext
client passwords и canonical bcrypt verifiers задаются раздельно.

## Secrets

`.env.example` — перечень переменных, а не production-конфигурация. Все
service tokens, DB/Redis passwords, NATS credentials и encryption keys должны
быть случайными и различаться. `service-token-preflight` проверяет наличие,
формат, placeholders и повторное использование без вывода значений.

`pnpm dokploy:env:generate` создаёт игнорируемый Git файл
`.env.dokploy.generated` с уникальными внутренними секретами и согласованными
NATS password/bcrypt парами. Точная double-dollar transport-форма совместима
как со старым dotenv rewrite, так и с новым quoting Dokploy: runtime приводит
её к canonical bcrypt перед проверкой и рендерингом. Вручную после этого
заполняются только значения, выданные владельцем домена, SMTP, S3, Telegram и
platform-provider account. Для четырёх
Dokploy PostgreSQL backup jobs пароль отдельно не вводится: `postgres` передаёт тот же
`POSTGRES_PASSWORD` как `PGPASSWORD` внутреннему `pg_dump`.

Особые boundary:

- management и execution keyrings credential vault;
- rank grant/manifest/result credentials;
- Realtime notification/Web Push credentials;
- auth-email SMTP/NATS/DB credentials;
- YooKassa secret только в Core child process.
- Telegram bot token только в Core alert-receiver child process; остальные
  supervisors получают отдельный `OPERATIONAL_ALERT_TOKEN`.
- исходные platform XMLStock/Arsenkin credentials только в Execution HTTP
  management child; Core получает лишь feature flag и customer price.
- `JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN` получают только Core API и
  connector child. Он не переиспользует rank-grant credential и разрешает
  только exact capture после provider response.

## Optional capabilities

- production template включает S3 и изолирует objects через
  `S3_KEY_PREFIX`; при `S3_ENABLED=false` object storage flows отключены;
- `MALWARE_SCANNER_ENABLED=false` не запускает inspection child;
- `WEB_PUSH_DELIVERY_ENABLED=false` не запускает Web Push sender;
- `YOOKASSA_ENABLED=false` не активирует payment adapter.
- `TELEGRAM_ALERTS_ENABLED=false` оставляет private receiver доступным для
  health, но отключает внешнюю доставку;
- `PLATFORM_XMLSTOCK_ENABLED=false` и `PLATFORM_ARSENKIN_ENABLED=false`
  скрывают системные provider credentials и платный rank path. При включении
  plural-переменные `*_API_KEYS`/`*_ACCOUNT_IDS` принимают comma-separated
  pool до 64 ключей; singular-варианты оставлены для одного legacy key.
  `*_DAILY_SPEND_LIMIT_MINOR` и `*_MONTHLY_SPEND_LIMIT_MINOR` обязательны:
  Core атомарно учитывает captured usage и все живые reservations по UTC.

Transactional email в текущем Compose включён и требует отдельные
`AUTH_EMAIL_*` credentials. Недоступная capability должна возвращать честное
degraded/unavailable состояние, а не имитировать успех.

Для файлов S3 import-worker принимает `UPLOAD_FILE_RETENTION_DAYS=30` и
`EXPORT_FILE_RETENTION_DAYS=7`. Значения задают срок хранения исходных
загрузок и готовых экспортов в днях, не срок хранения строк в PostgreSQL и
не срок хранения backup. Очистка запускается при старте и каждый час;
незавершённые импорты не теряют исходный файл. Изменение env применяется
после redeploy и к уже существующим файлам старше нового срока.

Стартовый профиль XMLStock для 8 CPU / 16 GiB: три connector process по
`RANK_CONNECTOR_CONCURRENCY=32`, общий Redis-предел
`XMLSTOCK_GLOBAL_HTTP_CONCURRENCY=96`, PostgreSQL pool каждого connector
`JOBS_CONNECTOR_DATABASE_POOL_MAX=16`, Redis Jobs `maxmemory 1gb` внутри
контейнера `1536M`. Это конфигурация для нагрузочной проверки, а не
подтверждённая гарантия 96 одновременных ответов провайдера. Сохранённые в
Dokploy env значения перекрывают Compose defaults: при развёртывании обновить
их вручную и следить за CPU, RSS, Redis и PostgreSQL wait/connection count.
Redis выдаёт эти слоты с work-conserving fair share между физическими
XMLStock-ключами; один key/product делит свой потолок между активными
workspace с одинаковым ключом. `RANK_WORKER_PROCESSES` и
`SYSTEM_WORKER_CONCURRENCY` не задают число внешних XMLStock HTTP-потоков.
Один XMLStock `Парсинг Wordstat` запускает параллельно столько seed-запросов,
сколько допускает остаток результата без лишнего списания (при лимите
10 000 строк — первоначально до пяти); `KEYWORD_RESEARCH_CONCURRENCY` ограничивает
число одновременных research Jobs на процесс, а не запросов внутри одного Job.
Research lanes распределены между connector process и запускаются секундным
dispatcher, поэтому для одного запуска не нужно повышать этот параметр выше 1.

## Проверка

```bash
pnpm infra:test
pnpm infra:validate:example
pnpm infra:validate
```

Последние две команды требуют Docker Compose. Opt-in live tests используют
явно переданные disposable PostgreSQL 18/Redis binaries; без них тесты
корректно пропускаются.

## Основные каталоги

- `docker` — production image stages;
- `postgres` — bootstrap, migrations permission orchestration и ACL;
- `redis` — configs и ACL renderer;
- `nats` — config renderer и topology provisioner;
- `security` — deploy credential preflight;
- `generate-dokploy-env.sh` — fail-safe генератор production environment;
- `tests` — статические и opt-in live infrastructure proofs;
- `monitoring` — Prometheus/alert rules;
- `runbooks` — credential/recovery procedures;
- `vps` — single-node production-like runtime.

Database backup настраивается в Dokploy отдельно для каждой из четырёх
логических PostgreSQL databases. Для Redis Jobs и NATS доступны дополнительные
named-volume backups; Realtime Redis намеренно ephemeral.

Настройка и canary внутренних ошибок описаны в
[`runbooks/operational-alerts.md`](./runbooks/operational-alerts.md).

Изменение application topology, data ownership, database/queue/event или
security boundary требует обновить `PROJECT_MAP.md`; data ownership — также
ADR.
