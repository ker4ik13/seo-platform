# Развёртывание в Dokploy

## Результат

Один Compose project собирает три прикладных сервиса:

- `frontend`;
- `backend-core`;
- `backend-execution`.

PostgreSQL, два Redis, NATS и production ClamAV поднимаются в том же private
stack. Итого это восемь long-running containers при включённом profile
`inspection` и четырнадцать one-shot migration/permission/preflight
containers. One-shot containers завершаются до старта backend и не требуют
отдельного управления как приложения.

`backend-execution` запускает по умолчанию два rank и два connector child
process. Это остаётся одним Dokploy service; масштаб регулируется
`RANK_WORKER_PROCESSES` и `CONNECTOR_WORKER_PROCESSES`, а отдельные queue
concurrency — `RANK_CONNECTOR_CONCURRENCY`,
`FREQUENCY_COLLECTION_CONCURRENCY` и `KEYWORD_RESEARCH_CONCURRENCY`.
Увеличение этих значений повышает локальный параллелизм, но не обходит общий
provider capacity и поэтому само по себе не умножает платные запросы сверх
настроенного broker limit.

## 1. Создание проекта

1. Создать в Dokploy обычный Compose project из этого Git repository.
2. Указать Compose path `infrastructure/compose.dokploy.yml`.
3. Выполнить `pnpm dokploy:env:generate`, заполнить пустые значения под
   комментариями `# ВРУЧНУЮ (обязательно)` и вставить полученный
   `.env.dokploy.generated` в environment variables проекта.
4. Выполнить deploy. Миграции Prisma и least-privilege DB grants запускаются
   автоматически перед backend. Core и Execution после этого сходятся по
   readiness одновременно: Execution ждёт запуска Core, но не его итогового
   `healthy`, поскольку readiness Core сама проверяет Execution.

Полный перечень значений, правила генерации, настройка application S3 и
четырёх database backups находятся в
[`DOKPLOY-SECRETS.md`](./DOKPLOY-SECRETS.md).

Используются Node.js 24/pnpm 11 и pinned OCI images. Dockerfile build context
должен оставаться корнем репозитория.

## 2. Домены

Добавить маршруты Dokploy/Traefik:

| Публичный адрес | Compose service | Container port |
|---|---|---:|
| основной web domain | `frontend` | 3000 |
| API domain | `backend-core` | 4000 |
| Realtime domain или path | `backend-core` | 4003 |

Порт 4001 — только internal SEO compatibility API. `backend-execution:4002`
тоже internal-only. Data services и NATS monitor наружу не публиковать.

Значения должны совпадать с routes:

```dotenv
WEB_PUBLIC_URL=https://example.com
API_PUBLIC_URL=https://api.example.com
```

TLS завершается в Traefik. Для production оставить `AUTH_COOKIE_SECURE=true`.

## 3. Обязательные группы secrets

- PostgreSQL administrator, owner и runtime passwords, включая изолированную
  Web Push role;
- восемь разных Redis passwords;
- пять NATS usernames, client passwords и соответствующие bcrypt 2a cost-11
  verifier hashes;
- все направленные `*_TOKEN` и `RANK_HISTORY_CURSOR_KEY`;
- auth pepper/data key и два независимых credential-vault keyring;
- `AUTH_EMAIL_*` SMTP credentials.

Каждое значение должно быть уникальным. URL-embedded DB/Redis passwords
генерировать URL-safe алфавитом. Keyring value — base64url-encoded 32 bytes в
формате `1:<key>`. Не переносить `.env` в Git, build args или публичные
Dokploy labels.

Генератор создаёт эти значения автоматически и не перезаписывает уже
созданный файл. Единственный секрет, который вводится повторно вручную вне
Compose, — `POSTGRES_PASSWORD` в четырёх настройках PostgreSQL backup.

До первого deploy проверить локально:

```bash
pnpm infra:validate
```

`service-token-preflight` повторяет secret validation внутри deployment и
останавливает startup при placeholder, пропуске или reuse.

## 4. Опциональные функции

- Object storage включён в production template: заполнить все `S3_*` и
  выбрать неизменяемый `S3_KEY_PREFIX` до первого upload.
- Malware inspection включён в production template через
  `MALWARE_SCANNER_ENABLED=true` и Compose profile `inspection`. Для
  осознанного отключения убрать profile и выставить flag в `false`.
- Web Push: сначала заполнить VAPID/encryption keys и отдельный DB password,
  затем включить registration/delivery flags.
- YooKassa: заполнить shop/secret/return URL и только затем
  `YOOKASSA_ENABLED=true`.

XMLStock/Arsenkin credentials вводятся в интерфейсе интеграций и не
добавляются в Compose environment.

## 5. Проверка после deploy

Проверить readiness:

- `backend-core:4000/health/ready`;
- `backend-core:4003/health/ready`;
- `backend-execution:4002/health/ready` из private network;
- `frontend:3000/ru`.

Затем пройти: login/session refresh, создание проекта, ручной rank estimate и
Top-100 run, task terminal state, Realtime reconnect. Проверить, что логи не
содержат service tokens, database URLs, SMTP/provider credentials.

## 6. Обновление и rollback

Deploy новой ревизии повторно применяет только ещё не применённые Prisma
migrations и идемпотентно восстанавливает ACL. Перед migration release нужен
backup PostgreSQL и review migration SQL. Application rollback выполняется на
предыдущий Git revision; необратимую migration нельзя откатывать заменой
image — для неё заранее готовится forward fix/restore plan.

## 7. Backup

В production нужно создать четыре Dokploy compose database backup — отдельно
для `platform_db`, `seo_db`, `realtime_db` и `jobs_db`, service name во всех
случаях `postgres`. Persistent data использует named volumes, поэтому для
`redis_jobs_data` и `nats_data` дополнительно доступен Dokploy Volume Backup.
PostgreSQL следует резервировать логическим database backup, а не snapshot
живого volume. Точные prefixes, cron и S3-поля приведены в
[`DOKPLOY-SECRETS.md`](./DOKPLOY-SECRETS.md).
