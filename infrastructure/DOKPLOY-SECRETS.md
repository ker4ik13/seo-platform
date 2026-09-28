# Переменные, S3 и резервные копии в Dokploy

Этот документ относится к `infrastructure/compose.dokploy.yml`. Канонический
шаблон всех переменных — корневой `.env.example`: его нужно целиком вставить в
`Compose → Environment`, а затем заменить placeholders и пустые обязательные
значения. Production `.env` не хранится в Git.

Самый безопасный путь — сначала автоматически создать локальный файл с
уникальными внутренними секретами:

```bash
pnpm dokploy:env:generate
```

Команда создаёт `.env.dokploy.generated` с правами `0600`, не печатает
секреты в терминал, не перезаписывает существующий файл и сразу создаёт
правильные связанные пары NATS password/bcrypt hash. Файл игнорируется Git.
В нём присутствуют все строки environment; незаполненными останутся только
поля под комментариями `# ВРУЧНУЮ`, которые выдаются внешними провайдерами:
домены, SMTP, S3 и параметры отключённых опциональных интеграций. Обязательные
поля прямо помечены `(обязательно)`. После их заполнения содержимое файла
целиком вставляется в `Compose → Environment`.

Compose не выполняет `openssl`, shell substitution или другие команды внутри
значений и не должен генерировать секреты при каждом restart/deploy. Если
автогенератор не используется, команды ниже нужно запускать отдельно для
каждой строки, вставляя только их результат.

Разные secret variable names всегда имеют разные значения. Одинаковое
значение вручную вводится повторно только в одном месте вне Compose:
`POSTGRES_PASSWORD` из environment используется как password во всех четырёх
Dokploy PostgreSQL backup jobs. Внутри Compose один и тот же variable name
автоматически передаётся всем нужным контейнерам.

## 1. Что разворачивается

Один Dokploy Compose project запускает:

- `frontend`, `backend-core`, `backend-execution`;
- один PostgreSQL 18 с четырьмя логическими базами `platform_db`, `seo_db`,
  `realtime_db`, `jobs_db`;
- два изолированных Redis: durable Jobs и ephemeral Realtime;
- NATS JetStream;
- ClamAV при `COMPOSE_PROFILES=inspection`;
- private operational-alert receiver как child `backend-core`;
- one-shot preflight, migrations и exact-permission containers.

Постоянные данные находятся только в named volumes `postgres_data`,
`redis_jobs_data`, `nats_data`, `clamav_data`. S3 является внешним сервисом и
в Compose не запускается.

## 2. Обязательные адреса

Заменить домены на свои:

```dotenv
WEB_PUBLIC_URL=https://seo.example.com
WEB_WWW_REDIRECT_HOST=www.seo.example.com
API_PUBLIC_URL=https://api.seo.example.com
```

`WEB_PUBLIC_URL` — canonical origin без завершающего `/`. В Dokploy ему
соответствует `frontend:3000`; туда же нужно направить hostname из
`WEB_WWW_REDIRECT_HOST`. Frontend перенаправит его permanent `308` на
canonical origin, сохранив путь и параметры. API domain направляется на
`backend-core:4000`. Realtime domain либо отдельный path направляется на
`backend-core:4003`.

Для production оставить:

```dotenv
AUTH_COOKIE_SECURE=true
NATS_EVENT_ENVIRONMENT=production
COMPOSE_PROFILES=inspection
MALWARE_SCANNER_ENABLED=true
```

## 3. Обязательные secrets

Все значения в каждой группе должны быть независимыми. Для DB, Redis,
service-token и NATS client password использовать URL-safe строку длиной не
меньше 32 символов из `[A-Za-z0-9._~-]`. Одна подходящая команда для каждого
нового значения:

```bash
openssl rand -hex 32
```

### 3.1. PostgreSQL

Нужно заполнить все перечисленные значения, включая Web Push password даже
при выключенной отправке: он используется one-shot контейнером для создания
изолированной DB role.

```dotenv
POSTGRES_PASSWORD=
PLATFORM_DATABASE_OWNER_PASSWORD=
PLATFORM_DATABASE_PASSWORD=
SEO_DATABASE_OWNER_PASSWORD=
SEO_DATABASE_PASSWORD=
JOBS_DATABASE_OWNER_PASSWORD=
JOBS_DATABASE_PASSWORD=
JOBS_RANK_DATABASE_PASSWORD=
JOBS_AUTH_EMAIL_DATABASE_PASSWORD=
JOBS_CONNECTOR_DATABASE_PASSWORD=
REALTIME_DATABASE_OWNER_PASSWORD=
REALTIME_DATABASE_PASSWORD=
REALTIME_WEB_PUSH_DATABASE_PASSWORD=
```

`POSTGRES_USER=platform` менять не требуется. Owner passwords получают только
migration containers; application processes используют least-privilege
runtime roles.

### 3.2. Redis

```dotenv
REDIS_JOBS_API_PASSWORD=
REDIS_JOBS_SYSTEM_PASSWORD=
REDIS_JOBS_INSPECTION_PASSWORD=
REDIS_JOBS_IMPORT_PASSWORD=
REDIS_JOBS_RANK_PASSWORD=
REDIS_JOBS_CRAWL_PASSWORD=
REDIS_JOBS_CONNECTOR_PASSWORD=
REDIS_REALTIME_PASSWORD=
```

### 3.3. Внутренние service credentials

```dotenv
PLATFORM_API_TO_SEO_DATA_TOKEN=
PLATFORM_API_TO_JOBS_TOKEN=
JOBS_TO_SEO_DATA_TOKEN=
PLATFORM_API_TO_REALTIME_TOKEN=
JOBS_TO_SEO_RANK_TOKEN=
JOBS_TO_PLATFORM_RANK_GRANT_TOKEN=
JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN=
JOBS_TO_PLATFORM_AUTOMATION_TOKEN=
JOBS_TO_SEO_RANK_RESULT_TOKEN=
JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN=
RANK_HISTORY_CURSOR_KEY=
PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN=
PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN=
REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN=
OPERATIONAL_ALERT_TOKEN=
```

Preflight отклонит placeholder, повтор одного значения или не-URL-safe
символ. Эти токены нельзя заменять одним «общим секретом».

### 3.4. Telegram operational alerts

Для включения внешней доставки нужны:

```dotenv
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_ALERT_BOT_TOKEN=
TELEGRAM_ALERT_CHAT_ID=
TELEGRAM_ALERT_THREAD_ID=
TELEGRAM_ALERT_ENVIRONMENT=production
```

Bot token получает только `backend-core` alert child; Frontend и Execution
получают `OPERATIONAL_ALERT_TOKEN`, но не Telegram destination. Порт 4004
остаётся private. До production выполнить canary и failure checks по
[`runbooks/operational-alerts.md`](./runbooks/operational-alerts.md).

### 3.5. NATS

Безопасные usernames уже заданы в `.env.example`; для каждой identity нужны
отдельный plaintext client password и соответствующий ему canonical bcrypt
`2a`, cost `11` hash:

```dotenv
NATS_RUNTIME_PASSWORD=
NATS_RUNTIME_PASSWORD_HASH=
NATS_PLATFORM_PUBLISHER_PASSWORD=
NATS_PLATFORM_PUBLISHER_PASSWORD_HASH=
NATS_REALTIME_CONSUMER_PASSWORD=
NATS_REALTIME_CONSUMER_PASSWORD_HASH=
NATS_AUTH_EMAIL_CONSUMER_PASSWORD=
NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH=
NATS_PROVISIONER_PASSWORD=
NATS_PROVISIONER_PASSWORD_HASH=
```

NATS password обязан начинаться с ASCII-буквы. Пример генерации одной пары на
локальной машине:

```bash
python3 -m venv /tmp/seo-nats-secrets
/tmp/seo-nats-secrets/bin/pip install bcrypt
NATS_RUNTIME_PASSWORD="n$(openssl rand -hex 32)"
NATS_RUNTIME_PASSWORD_HASH="$(printf %s "$NATS_RUNTIME_PASSWORD" | \
  /tmp/seo-nats-secrets/bin/python -c \
  'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(rounds=11, prefix=b"2a")).decode())')"
```

Повторить с новым password для каждой из пяти identities. Dokploy сначала
разбирает вставленный environment через dotenv, снимает внешние кавычки, а
затем создаёт собственный `.env` для Compose. Поэтому каждый `$` в bcrypt
нужно удвоить именно в поле Dokploy:

```dotenv
NATS_RUNTIME_PASSWORD_HASH='$$2a$$11$$...'
```

Это транспортное экранирование: контейнер и preflight получат canonical
значение `$2a$11$...` на старых версиях Dokploy. Новые версии могут сохранить
двойные доллары из-за собственного quoting; preflight и NATS renderer принимают
эту точную transport-форму и перед использованием приводят её к canonical
hash. Одни кавычки вокруг single-dollar hash для старых Dokploy недостаточны.
Не выполнять замену `$` во всём environment — только в пяти
`NATS_*_PASSWORD_HASH`; уже сохранённые значения при обновлении Dokploy менять
не требуется.

При использовании `pnpm dokploy:env:generate` этот раздел выполняется
автоматически: сгенерированные hash-строки уже содержат `$$`, вручную
редактировать NATS пары не нужно.

### 3.6. Шифрование и аутентификация

```dotenv
AUTH_PASSWORD_PEPPER=
AUTH_DATA_ENCRYPTION_KEY=
INTEGRATION_CREDENTIAL_KEYS=1:<base64url-32-bytes>
INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION=1
INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS=1:<other-base64url-32-bytes>
INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION=1
```

Для каждого 32-byte base64url key:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

`AUTH_DATA_ENCRYPTION_KEY` имеет тот же формат. Для
`AUTH_PASSWORD_PEPPER` достаточно отдельного `openssl rand -hex 32`.
Encryption key и fingerprint key не должны совпадать. После записи данных
старую key version нельзя удалять из keyring до полной ротации данных.

### 3.7. SMTP

Transactional email включён в production-compose, поэтому нужны:

```dotenv
AUTH_EMAIL_FROM=no-reply@example.com
AUTH_EMAIL_MESSAGE_ID_DOMAIN=example.com
AUTH_EMAIL_SMTP_HOST=smtp.example.com
AUTH_EMAIL_SMTP_PORT=587
AUTH_EMAIL_SMTP_SECURE=false
AUTH_EMAIL_SMTP_USER=
AUTH_EMAIL_SMTP_PASSWORD=
```

Для implicit TLS обычно используются port `465` и
`AUTH_EMAIL_SMTP_SECURE=true`; точные значения определяет SMTP-провайдер.

## 4. S3 для файлов приложения

Это отдельный доступ приложения к upload/import/report objects. Рекомендуется
выдать ему отдельную IAM identity, не совпадающую с identity резервных копий.

```dotenv
S3_ENABLED=true
S3_ENDPOINT=https://<s3-endpoint>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<application-access-key>
S3_SECRET_ACCESS_KEY=<application-secret-key>
S3_BUCKET_UPLOADS=<bucket-name>
S3_BUCKET_ARTIFACTS=<bucket-name>
S3_KEY_PREFIX=seo-platform/production
S3_FORCE_PATH_STYLE=false
```

Для AWS поле `S3_ENDPOINT` можно оставить пустым. Для S3-compatible storage
нужно указать HTTPS endpoint провайдера; `S3_FORCE_PATH_STYLE=true` включать
только если это требует провайдер. Можно указать один bucket в обоих
`S3_BUCKET_*` либо два разных bucket.

При показанных значениях физические object keys будут выглядеть так:

```text
seo-platform/production/uploads/<workspace>/<project>/<object>
seo-platform/production/artifacts/<workspace>/<project>/<object>
```

`S3_KEY_PREFIX` — путь без начального/конечного `/`, `//` и `..`. После
первого production upload его нельзя менять без переноса уже существующих
objects: в БД сохраняется логический key, а prefix добавляется S3-адаптером.

IAM policy приложения должна разрешать bucket listing/health check и только
необходимые object/multipart actions внутри выбранных buckets/prefix:
`ListBucket`, `GetObject`, `PutObject`, `DeleteObject`,
`AbortMultipartUpload`, `ListBucketMultipartUploads`,
`ListMultipartUploadParts`.

BYOK credentials XMLStock/Arsenkin не являются deploy secrets. Они добавляются
владельцем рабочей области через UI и сохраняются в зашифрованном vault.

Системные platform-paid credentials являются отдельными deploy secrets:

```dotenv
PLATFORM_XMLSTOCK_ENABLED=false
PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR=
PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR=
PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR=
PLATFORM_XMLSTOCK_API_KEYS=
PLATFORM_XMLSTOCK_ACCOUNT_IDS=
PLATFORM_XMLSTOCK_API_KEY=
PLATFORM_XMLSTOCK_ACCOUNT_ID=
PLATFORM_XMLSTOCK_SOFT_ID=
PLATFORM_ARSENKIN_ENABLED=false
PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR=
PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR=
PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR=
PLATFORM_ARSENKIN_API_KEYS=
PLATFORM_ARSENKIN_API_KEY=
```

В `PLATFORM_XMLSTOCK_API_KEYS` и `PLATFORM_XMLSTOCK_ACCOUNT_IDS` должно быть
одинаковое число элементов. Пара с индексом `i` всегда образует один физический
аккаунт XMLStock; один account ID нельзя повторять для нескольких API-ключей.
`PLATFORM_XMLSTOCK_SOFT_ID` задаёт выданный XMLStock партнёрский идентификатор
для всех исходящих запросов: системных, BYOK, проверки аккаунта и опроса
отложенного результата. Значение не зависит от `PLATFORM_XMLSTOCK_ENABLED`.

Цена задаётся в minor units за одну keyword-context проверку, положительным
целым не больше `61489146912`. При включённом provider flag обязательны цена и
все его credentials; preflight отклоняет частичную конфигурацию. Для пула
используются plural-переменные со значениями через запятую. XMLStock принимает
только список уникальных account ID той же длины, что и API keys; элементы
связываются строго по индексу. Singular и plural одновременно задавать нельзя.
Эти flags
нельзя включать в production до письменного разрешения provider, заполненных
суточного/месячного hard budgets,
balance alert и fault-injection canary порядка reserve → provider response →
Core settlement → local complete. Для синхронного XMLStock перед provider
response выполняется bounded HOLD без ledger mutation. Dedicated settlement
token получает только Core API и connector child; он не совпадает с grant
token.

## 5. S3 destination для backup в Dokploy

В `Settings → S3 Destinations` создать отдельный destination и заполнить:

| Поле Dokploy | Значение |
|---|---|
| Access Key | backup-only S3 access key |
| Secret Key | backup-only S3 secret key |
| Bucket | bucket для backup |
| Region | регион bucket |
| Endpoint | HTTPS endpoint провайдера; для AWS — стандартный endpoint |

Один bucket для application objects и backup допустим, но identities и
prefixes должны быть разными. Рекомендуемая структура:

```text
seo-platform/production/app/...
seo-platform/production/backups/postgres/...
seo-platform/production/backups/volumes/...
```

Если используется эта структура, для приложения поставить
`S3_KEY_PREFIX=seo-platform/production/app`.

## 6. Четыре PostgreSQL backup job

В Compose project открыть `Backups` и создать четыре записи. Для всех:

- Type: `PostgreSQL` / compose database backup;
- Service name: `postgres`;
- Destination: созданный S3 destination;
- Enabled: `true`;
- Keep latest: минимум `30` для ежедневных копий;
- Database User: `platform` (значение `POSTGRES_USER`);
- отдельного поля пароля у PostgreSQL Compose backup нет: сервис уже передаёт
  существующий `POSTGRES_PASSWORD` клиенту `pg_dump` через `PGPASSWORD`.

Разнести jobs по времени:

| Database | Prefix | Пример cron |
|---|---|---|
| `platform_db` | `seo-platform/production/backups/postgres/platform_db` | `15 2 * * *` |
| `seo_db` | `seo-platform/production/backups/postgres/seo_db` | `30 2 * * *` |
| `realtime_db` | `seo-platform/production/backups/postgres/realtime_db` | `45 2 * * *` |
| `jobs_db` | `seo-platform/production/backups/postgres/jobs_db` | `0 3 * * *` |

Cron исполняется в timezone сервера/Dokploy — проверить её перед выбором
окна. Для каждой записи сразу нажать `Test`, убедиться в появлении объекта в
нужном prefix и затем выполнить пробное восстановление в отдельный временный
PostgreSQL. Успешная загрузка файла без restore drill не считается проверенным
backup.

Dokploy database backup является логическим dump. Для небольшого single-node
старта этого достаточно как базового слоя, но он не даёт point-in-time
recovery; при строгом RPO дополнительно нужен PostgreSQL WAL/PITR contour.

## 7. Backup named volumes

Dokploy умеет сохранять в S3 только Docker named volumes; Compose уже
использует именно их. Для PostgreSQL предпочтительны четыре консистентных
database backups выше, а не snapshot живого `postgres_data`.

Дополнительно можно создать Volume Backup для:

- `redis_jobs_data` — ускоряет восстановление очередей, но PostgreSQL остаётся
  источником истины;
- `nats_data` — сохраняет JetStream replay state;
- `clamav_data` — необязательно, сигнатуры можно скачать заново.

Для записываемых volumes безопасный режим — `Turn off Container`. Его следует
включать только в согласованное maintenance window, потому что остановка
Redis/NATS временно переводит backend в degraded state. `redis-realtime`
намеренно хранится в tmpfs и не резервируется.

## 8. Перед первым production deploy

1. Вставить полный `.env.example` в Dokploy и заменить все placeholders.
2. Проверить, что никакие secret values не повторяются.
3. Прогнать `pnpm infra:validate` локально там, где установлен Docker Compose.
4. Выполнить deploy и дождаться успешного завершения всех one-shot services.
5. Проверить health/readiness из `DOKPLOY.md`.
6. При включённом Telegram выполнить operational canary и dedupe check.
7. Настроить и вручную протестировать четыре DB backup.
8. Экспортировать конфигурацию Dokploy и хранить recovery-доступ отдельно от
   production VPS.

Официальные справки Dokploy:

- <https://docs.dokploy.com/docs/core/docker-compose>;
- <https://docs.dokploy.com/docs/core/databases/backups>;
- <https://docs.dokploy.com/docs/core/volume-backups>;
- <https://docs.dokploy.com/docs/core/aws-s3>.
