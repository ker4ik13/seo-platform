# Runtime SEOньорита на текущем VPS

Этот каталог поднимает production-сборки SEOньорита без Docker и без
`sudo`. Все данные и локальные секреты находятся вне Git в
`/home/dev/.local/share/seo-platform-runtime`, а процессы переживают разрыв SSH
в отдельной `tmux`-сессии `seo-platform-runtime`.

Это runtime для одного узла. Он не заменяет production backup, мониторинг,
HA/репликацию и внешний secret manager.

PostgreSQL запускается с `POSTGRES_MAX_CONNECTIONS=250` по умолчанию. Лимит
покрывает суммарный бюджет изолированных service pools и не позволяет
connector shards вытеснять API/SEO соединения под нагрузкой.

## Топология

| Компонент | Адрес | Доступ |
| --- | --- | --- |
| Web | `127.0.0.1:3000` | через установленный системный Caddy |
| Platform API | `127.0.0.1:4000` | только loopback |
| SEO Data | `127.0.0.1:4001` | только loopback |
| Jobs | `127.0.0.1:4002` | только loopback |
| Realtime | `127.0.0.1:4003` | только loopback |
| Operational alerts | `127.0.0.1:4004` | только loopback |
| PostgreSQL 18 | `127.0.0.1:5432` | отдельные owner/runtime-роли |
| Redis Jobs / Realtime | `127.0.0.1:6379/6380` | отдельные ACL |
| NATS JetStream / monitor | `127.0.0.1:4222/8222` | отдельные identities |
| MinIO API / console | `127.0.0.1:9000/9001` | console не публикуется |
| ClamAV | `127.0.0.1:3310` | только inspection worker |
| Public object storage | `<PUBLIC_HOST>:9443` | TLS через системный Caddy |

`storage-proxy.sh` управляет только отдельным Caddy server
`srv_storage` через loopback admin API `127.0.0.1:2019`. Он не изменяет
остальные Caddy routes. Watcher восстанавливает этот route после reload Caddy,
а `stop-runtime.sh` удаляет его.

## Команды

Запускать из корня repository:

```bash
POSTGRES_DISTRIBUTION_ROOT=/absolute/path/postgres-18 \
REDIS_SERVER_BINARY=/absolute/path/redis-server \
REDIS_CLI_BINARY=/absolute/path/redis-cli \
NATS_SERVER_BINARY=/absolute/path/nats-server \
SEO_PLATFORM_PUBLIC_URL=https://example.com \
  infrastructure/vps/bootstrap-runtime.sh
infrastructure/vps/start-runtime.sh
infrastructure/vps/status-runtime.sh
SEO_PLATFORM_SMOKE_CONFIRM=CREATE_TEST_DATA \
  infrastructure/vps/smoke-runtime.sh
infrastructure/vps/stop-runtime.sh
```

Для визуальной проверки на копии production-данных connector workers можно
явно не запускать, чтобы незавершённые платные Jobs не ушли провайдерам:

```bash
SEO_PLATFORM_PAID_CONNECTOR_RUNTIME=false \
  infrastructure/vps/start-runtime.sh
```

Credential validation продолжает работать, а rank/frequency/research/AI/
clustering provider workers не потребляют старые платные очереди. Реальные
provider smoke-тесты запускаются отдельно с явным bounded budget.

Browser Web Push включается отдельной операторской командой только на
остановленном runtime. Команда создаёт VAPID, AES-256-GCM и HMAC ключи,
атомарно сохраняет их исключительно в mode-600 `runtime.env`; приватный VAPID
ключ получает только isolated sender process:

```bash
infrastructure/vps/stop-runtime.sh
SEO_PLATFORM_WEB_PUSH_SUBJECT=mailto:monitored@example.com \
  infrastructure/vps/configure-web-push.sh
infrastructure/vps/start-runtime.sh
```

Для preview допустим default contact subject команды. Перед production
release его необходимо заменить на контролируемый адрес. Повторный запуск не
вращает существующую пару ключей.

Transactional email для подтверждения адреса, восстановления пароля и
приглашений также включается только на остановленном runtime. Команда сначала
проверяет TLS-соединение и SMTP-авторизацию, затем атомарно сохраняет реквизиты
в `runtime.env`; при неуспешной проверке рабочая конфигурация не меняется.
Пароль вводится без echo и не попадает в аргументы процесса или логи:

```bash
infrastructure/vps/stop-runtime.sh
SEO_PLATFORM_AUTH_EMAIL_FROM=no-reply@example.com \
SEO_PLATFORM_AUTH_EMAIL_SMTP_HOST=smtp.example.com \
SEO_PLATFORM_AUTH_EMAIL_SMTP_PORT=587 \
SEO_PLATFORM_AUTH_EMAIL_SMTP_SECURE=false \
SEO_PLATFORM_AUTH_EMAIL_SMTP_USER=no-reply@example.com \
  infrastructure/vps/configure-auth-email.sh
infrastructure/vps/start-runtime.sh
```

Для почты Timeweb используются `smtp.timeweb.ru`, порт `587` с STARTTLS
(`SMTP_SECURE=false`) либо порт `465` с TLS (`SMTP_SECURE=true`); логин и From
должны совпадать с созданным почтовым ящиком (см. [официальные настройки
почтовых клиентов](https://timeweb.com/ru/docs/pochta/osnovnye-voprosy-po-rabote-s-pochtoj/osnovnye-nastrojki-pochtovyh-klientov/)). После запуска
`status-runtime.sh` обязан показывать `service=auth-email-worker status=ready`.

YooKassa adapter входит в Platform API. Подключение выполняется только на
остановленном runtime: shop ID передаётся как переменная, а secret вводится
без echo и остаётся в mode-600 `runtime.env`. Команда также включает
обязательную reconciliation и прямой Caddy route на стандартном HTTPS-порту:

```bash
infrastructure/vps/stop-runtime.sh
SEO_PLATFORM_YOOKASSA_SHOP_ID=123456 \
  infrastructure/vps/configure-yookassa.sh
infrastructure/vps/start-runtime.sh
```

Webhook YooKassa для текущего preview нужно направить на
`https://<PUBLIC_HOST>/api/v1/billing/providers/yookassa/webhook`. В кабинете
нужно включить события `payment.waiting_for_capture`, `payment.succeeded`,
`payment.canceled` и `refund.succeeded`. Caddy публикует только этот endpoint
на порту 443; Platform API остаётся на loopback. Merchant credentials runner
не генерирует, не выводит и в repository не сохраняет.

Внутренние error/fatal-события и неожиданные остановки компонентов можно
направить в отдельный private Telegram chat. Конфигуратор читает bot token без
echo, сначала отправляет canary и меняет mode-600 `runtime.env` только после
успеха:

```bash
infrastructure/vps/stop-runtime.sh
SEO_PLATFORM_TELEGRAM_ALERT_CHAT_ID=-1001234567890 \
  infrastructure/vps/configure-telegram-alerts.sh
infrastructure/vps/start-runtime.sh
```

Supervisor отправляет только allowlisted code/severity и локальный SHA-256
fingerprint; исходная строка лога, stack trace, tenant payload и секреты не
покидают VPS. Подробный rollout и проверка — в
[`../runbooks/operational-alerts.md`](../runbooks/operational-alerts.md).

`bootstrap-runtime.sh` принимает уже проверенные локальные пути
`POSTGRES_DISTRIBUTION_ROOT`, `REDIS_SERVER_BINARY`, `REDIS_CLI_BINARY` и
`NATS_SERVER_BINARY`, проверяет точные major/version, создаёт mode-600
`runtime.env` и локальные ACL. MinIO/mc и ClamAV должны быть установлены в
runtime directory до `start-runtime.sh`; start завершится ошибкой, если
обязательный binary или signature database отсутствует. Повторный bootstrap
идемпотентен и не перезаписывает существующие секреты.

`start-runtime.sh`:

1. проверяет production build artifacts;
2. запускает PostgreSQL и применяет все Prisma migrations;
3. запускает Redis/NATS и provision-ит точную JetStream topology;
4. provision-ит versioned MinIO buckets, least-privilege app policy и CORS;
5. запускает ClamAV, сервисы и отдельные workers;
   при настроенных Web Push или transactional email также запускает их
   isolated sender/worker и ждёт readiness;
6. ждёт readiness каждого обязательного компонента.

Private alert receiver стартует до migrations/backend и всегда слушает только
loopback; при выключенной Telegram-доставке он остаётся health endpoint без
внешнего side effect.

Полные логи находятся в
`/home/dev/.local/share/seo-platform-runtime/logs`. Секреты не передаются в
аргументах процессов, публичные URL или application logs.

## Проверка

`smoke-runtime.sh` создаёт уникального тестового пользователя и проверяет
рабочий путь:

`register → workspace → trial → project → team → crawl → multipart upload →
ClamAV inspection → semantic import → mapping/validation → publish`.

Smoke не вызывает платных внешних SEO API и не создаёт реальную оплату.
После проверки тестовые tenant-данные остаются в локальной БД для
диагностики.

Для сквозной проверки пользовательского семантического файла вместо
встроенного XLSX-fixture можно передать абсолютный путь и минимально ожидаемое
число уникальных запросов. Поддерживаются те же форматы, что и в UI, включая
нативный проект Key Collector `.kc4`:

```bash
SEO_PLATFORM_SMOKE_CONFIRM=CREATE_TEST_DATA \
SEO_PLATFORM_SMOKE_SEMANTIC_FILE=/absolute/path/project.kc4 \
SEO_PLATFORM_SMOKE_EXPECTED_KEYWORDS_MIN=1 \
SEO_PLATFORM_SMOKE_STORAGE_RELAY=true \
  infrastructure/vps/smoke-runtime.sh
```

`SEO_PLATFORM_SMOKE_STORAGE_RELAY=true` дополнительно проверяет браузерный
same-origin fallback для сетей, из которых отдельный storage-порт `9443`
недоступен. Signed URL не выводится и не попадает в application logs.

## Ротация

```bash
infrastructure/vps/rotate-nats-credentials.sh
infrastructure/vps/rotate-object-storage-root.sh
```

Обе команды требуют остановленный runtime, сохраняют mode-600 backup
`runtime.env`, атомарно обновляют локальные credentials и не выводят их в
stdout. App-level MinIO credential имеет отдельную policy и не совпадает с
root credential.

## Внешние production-gates

Следующие функции нельзя честно активировать без данных владельца:

- YooKassa: shop ID, secret, выбранный sandbox/live mode и зарегистрированный
  webhook;
- transactional email: SMTP host/user/password, verified sender и canary;
- реальные SEO-съёмы: BYOK credentials соответствующего провайдера;
- platform-paid XMLStock/Arsenkin: отдельный системный account, письменное
  разрешение, price book, заполненные суточный/месячный hard budgets, balance
  alert и fault-injection canary
  billing settlement;
- Telegram alerts: отдельный bot, private chat/topic и успешный canary;
- DNS-домен, если вместо текущего TLS по публичному IP нужен обычный hostname.

Эти значения должны храниться только в локальном `runtime.env` или внешнем
secret manager. Их нельзя добавлять в repository, URL, логи или queue payload.

## Ежедневная очистка и проверка диска

`install-maintenance.sh` ставит одно ежедневное задание в пользовательский
crontab на 04:17 по времени сервера, сохраняя остальные задания.
`maintain-runtime.sh --dry-run` показывает план; без флага выполняет его.
Команда использует `flock`, не читает `runtime.env` и не получает DB/S3 secrets.

Supervisor постоянно пишет через `bounded-log.mjs`: текущие 10 MiB и один
предыдущий сегмент до 10 MiB. Большие legacy-журналы сокращаются до хвоста.
Обслуживание удаляет архивы старше 14 дней и только управляемые каталоги
`runtime/tmp/{smoke-runtime,smoke-public-api,e2e}.*` старше 7 дней; живой PID и
symlink пропускаются. Рабочие БД, S3, пользовательские данные и backup исключены.
Вывод сохраняется в `logs/maintenance.log`. `status-runtime.sh` отдельно
проверяет свободное место и публичный HTTPS: readiness MinIO не гарантирует,
что диск принимает запись.

Новые повторяемые проверки:

```bash
SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA infrastructure/vps/test-browser.sh
SEO_PLATFORM_POSTGRES_TEST_CONFIRM=CREATE_ISOLATED_CLUSTER infrastructure/vps/test-postgres.sh
```

Browser runner использует установленный dev-only Playwright и Chromium.
При необходимости `SEO_PLATFORM_BROWSER_LIBRARIES` задаёт путь к системным
библиотекам. PostgreSQL runner создаёт отдельный кластер на свободном loopback
порту, применяет все миграции и запускает ACL/concurrency/regression tests;
рабочая конфигурация БД ему не передаётся. Оба runner сохраняют результаты в
управляемом `runtime/tmp/e2e.*`. Полный порядок работы —
[`../../docs/WORKING_GUIDE.md`](../../docs/WORKING_GUIDE.md).
