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

`backend-execution` запускает по умолчанию два rank и три connector child
process. Это остаётся одним Dokploy service; масштаб регулируется
`RANK_WORKER_PROCESSES` и `CONNECTOR_WORKER_PROCESSES`, а отдельные queue
concurrency — `RANK_CONNECTOR_CONCURRENCY`,
`FREQUENCY_COLLECTION_CONCURRENCY` и `KEYWORD_RESEARCH_CONCURRENCY`.
Увеличение этих значений повышает локальный параллелизм, но не обходит общий
provider capacity и поэтому само по себе не умножает платные запросы сверх
настроенного broker limit.

`backend-core` дополнительно запускает private operational-alert receiver на
`4004`. Это child process того же service, а не четвёртое приложение Dokploy.

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
| `www` web domain | `frontend` | 3000 |
| API domain | `backend-core` | 4000 |
| Realtime domain или path | `backend-core` | 4003 |

Порты 4001 и 4004 — только internal SEO compatibility API и operational-alert
receiver. `backend-execution:4002` тоже internal-only. Data services, receiver
и NATS monitor наружу не публиковать.

Значения должны совпадать с routes:

```dotenv
WEB_PUBLIC_URL=https://example.com
WEB_WWW_REDIRECT_HOST=www.example.com
API_PUBLIC_URL=https://api.example.com
```

`WEB_PUBLIC_URL` — единственный canonical origin Frontend без `/` в конце.
Он передаётся и на build, и в runtime; metadata, robots/sitemap, BFF Origin
проверки и auth-refresh redirects используют только его. Значение вроде
внутреннего имени контейнера или loopback-адреса запрещено в production.
`WEB_WWW_REDIRECT_HOST` содержит только hostname, без схемы, порта и пути.
Оба web domain направляются в Dokploy на `frontend:3000`; запрос с точным
`www` host получает permanent `308` на `WEB_PUBLIC_URL` с сохранением пути и
query string. Остальные hostnames этим правилом не затрагиваются.

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
созданный файл. В PostgreSQL backup jobs пароль вручную не вводится: форма
Compose backup Dokploy принимает только пользователя, а сервис `postgres`
передаёт существующий `POSTGRES_PASSWORD` клиенту `pg_dump` через
`PGPASSWORD`.

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
- Telegram: заполнить bot/chat destination, выполнить canary из runbook и
  только затем поставить `TELEGRAM_ALERTS_ENABLED=true`.
- Platform XMLStock/Arsenkin: исходный секрет, account ID где требуется и
  per-keyword customer price, суточный и месячный hard spend cap заполняются
  как deploy secrets. Feature flag оставлять `false` до legal approval,
  balance alert и
  fault-injection canary порядка provider response → billing settlement.

Пользовательские BYOK XMLStock/Arsenkin credentials по-прежнему вводятся в
интерфейсе и не добавляются в Compose environment. `PLATFORM_*` variables —
отдельный системный account платформы, недоступный пользователю.

## 5. Первый SUPER_ADMIN

MFA само по себе не выдаёт platform-доступ. После включения MFA нужно заново
войти в аккаунт, затем один раз открыть Terminal сервиса `backend-core` и
выполнить, заменив email на адрес входа владельца:

```bash
ADMIN_BOOTSTRAP_EMAIL='owner@example.com' \
ADMIN_BOOTSTRAP_REASON='Initial production operations owner' \
ADMIN_BOOTSTRAP_CONFIRM='CREATE_FIRST_SUPER_ADMIN' \
node /app/dist/platform-admin-bootstrap.js
```

Команду нужно вставить целиком одним блоком: присваивания на отдельных строках
без `export` не передаются дочернему процессу. Production bootstrap сам читает
`PLATFORM_DATABASE_URL` сервиса; абсолютный путь работает независимо от того,
в каком каталоге Dokploy открыл Terminal. Повтор команды для уже назначенного
этому аккаунту `SUPER_ADMIN` безопасен и возвращает ID существующего назначения.

В образах, собранных до появления корневого entrypoint, тот же bootstrap
доступен по пути
`/app/node_modules/@seo-platform/backend-core-api/dist/admin/platform-admin-bootstrap.js`.

Первичное назначение создаётся только пока в системе нет ни одной активной
platform role. Bootstrap проверяет активный аккаунт, подтверждённый email и
настроенный MFA, а затем пишет назначение и audit event в одной транзакции.
Исключение — безопасный повтор для уже назначенного этому аккаунту
`SUPER_ADMIN`. После успешной команды нужно завершить текущую сессию и снова
войти в `/admin` с MFA. Все последующие роли назначаются уже через `/admin`.

## 6. Проверка после deploy

Проверить readiness:

- `backend-core:4000/health/ready`;
- `backend-core:4003/health/ready`;
- `backend-core:4004/health/ready` из private network;
- `backend-execution:4002/health/ready` из private network;
- `frontend:3000/ru`.

Затем пройти: login/session refresh, создание проекта, ручной rank estimate и
Top-100 run, task terminal state, Realtime reconnect. Проверить, что логи не
содержат service tokens, database URLs, SMTP/provider credentials.
Если Telegram включён, выполнить canary по
[`runbooks/operational-alerts.md`](./runbooks/operational-alerts.md) и
проверить deduplication повторного fingerprint.

## 7. Обновление и rollback

Deploy новой ревизии повторно применяет только ещё не применённые Prisma
migrations и идемпотентно восстанавливает ACL. Перед migration release нужен
backup PostgreSQL и review migration SQL. Application rollback выполняется на
предыдущий Git revision; необратимую migration нельзя откатывать заменой
image — для неё заранее готовится forward fix/restore plan.

## 8. Backup

В production нужно создать четыре Dokploy compose database backup — отдельно
для `platform_db`, `seo_db`, `realtime_db` и `jobs_db`, service name во всех
случаях `postgres`. Persistent data использует named volumes, поэтому для
`redis_jobs_data` и `nats_data` дополнительно доступен Dokploy Volume Backup.
PostgreSQL следует резервировать логическим database backup, а не snapshot
живого volume. Точные prefixes, cron и S3-поля приведены в
[`DOKPLOY-SECRETS.md`](./DOKPLOY-SECRETS.md).
