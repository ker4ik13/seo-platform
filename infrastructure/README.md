# Инфраструктура SEOньориты

Каталог содержит production-like Compose для Dokploy, Dockerfiles, настройки
PostgreSQL/Redis/NATS, security preflight, tests, monitoring и VPS runbooks.

## Прикладные сервисы

В `compose.dokploy.yml` ровно три long-running application service:

| Service | Artifact | Internal ports |
|---|---|---:|
| `frontend` | `@seo-platform/frontend` | 3000 |
| `backend-core` | `@seo-platform/backend-core` | 4000, 4001, 4003 |
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
ClamAV и Execution API наружу не публикуются.

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
заполняются только значения, выданные владельцем домена, SMTP и S3. Для четырёх
Dokploy PostgreSQL backup jobs пароль отдельно не вводится: `postgres` передаёт тот же
`POSTGRES_PASSWORD` как `PGPASSWORD` внутреннему `pg_dump`.

Особые boundary:

- management и execution keyrings credential vault;
- rank grant/manifest/result credentials;
- Realtime notification/Web Push credentials;
- auth-email SMTP/NATS/DB credentials;
- YooKassa secret только в Core child process.

## Optional capabilities

- production template включает S3 и изолирует objects через
  `S3_KEY_PREFIX`; при `S3_ENABLED=false` object storage flows отключены;
- `MALWARE_SCANNER_ENABLED=false` не запускает inspection child;
- `WEB_PUSH_DELIVERY_ENABLED=false` не запускает Web Push sender;
- `YOOKASSA_ENABLED=false` не активирует payment adapter.

Transactional email в текущем Compose включён и требует отдельные
`AUTH_EMAIL_*` credentials. Недоступная capability должна возвращать честное
degraded/unavailable состояние, а не имитировать успех.

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

Изменение application topology, data ownership, database/queue/event или
security boundary требует обновить `PROJECT_MAP.md`; data ownership — также
ADR.
