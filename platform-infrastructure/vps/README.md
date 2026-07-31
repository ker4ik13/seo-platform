# Runtime SEO Platform на текущем VPS

Этот каталог поднимает production-сборки SEO Platform без Docker и без
`sudo`. Все данные и локальные секреты находятся вне Git в
`/home/dev/.local/share/seo-platform-runtime`, а процессы переживают разрыв SSH
в отдельной `tmux`-сессии `seo-platform-runtime`.

Это runtime для одного узла. Он не заменяет production backup, мониторинг,
HA/репликацию и внешний secret manager.

## Топология

| Компонент | Адрес | Доступ |
| --- | --- | --- |
| Web | `127.0.0.1:3000` | через установленный системный Caddy |
| Platform API | `127.0.0.1:4000` | только loopback |
| SEO Data | `127.0.0.1:4001` | только loopback |
| Jobs | `127.0.0.1:4002` | только loopback |
| Realtime | `127.0.0.1:4003` | только loopback |
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
  platform-infrastructure/vps/bootstrap-runtime.sh
platform-infrastructure/vps/start-runtime.sh
platform-infrastructure/vps/status-runtime.sh
SEO_PLATFORM_SMOKE_CONFIRM=CREATE_TEST_DATA \
  platform-infrastructure/vps/smoke-runtime.sh
platform-infrastructure/vps/stop-runtime.sh
```

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
6. ждёт readiness каждого обязательного компонента.

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

## Ротация

```bash
platform-infrastructure/vps/rotate-nats-credentials.sh
platform-infrastructure/vps/rotate-object-storage-root.sh
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
- DNS-домен, если вместо текущего TLS по публичному IP нужен обычный hostname.

Эти значения должны храниться только в локальном `runtime.env` или внешнем
secret manager. Их нельзя добавлять в repository, URL, логи или queue payload.
