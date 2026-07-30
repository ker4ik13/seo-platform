# Infrastructure / Dokploy

`compose.dokploy.yml` — первый удалённый контур. Он рассчитан на одну VPS:

- PostgreSQL 18 с отдельными databases для четырёх backend-контуров и Directus;
- Redis с AOF для BullMQ, Socket.IO и cache;
- NATS с JetStream;
- четыре NestJS API, отдельные system, inspection, import, rank и connector
  workers;
- единый web (`/`, `/tools`, `/docs`, `/app`), internal-only admin shell и
  Directus;
- S3 и SMTP подключаются как внешние managed/hosted сервисы.

## Первый запуск

1. Создать в Dokploy Compose-проект из корня репозитория.
2. Скопировать переменные из корневого `.env.example`, заменить все
   обязательные placeholders (`replace-me`, `replace-with-*`), URL и версии
   юридических документов. Пустые обязательные service secrets нужно
   сгенерировать отдельно; копировать примеры как реальные секреты запрещено.
   Отдельно обязательно задать `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`,
   `JOBS_TO_SEO_RANK_TOKEN`, `JOBS_TO_SEO_RANK_RESULT_TOKEN` и
   `RANK_HISTORY_CURSOR_KEY`: grant, result и cursor secrets намеренно
   оставлены пустыми в корневом примере, а старые копии примера могут ещё не
   содержать их.
3. Сначала оставить `S3_ENABLED=false`, `EMAIL_ENABLED=false`,
   `DIRECTUS_STORAGE_DRIVER=local`.
4. Привязать основной домен к `web:3000`, а нужные технические домены — к
   `platform-api:4000`, `realtime:4003` и `directus:8055`. Не создавать
   domain/route/port binding для `admin:3002`.
5. Развернуть compose. Migration services завершаются до запуска приложений.

## Web build-time public URL

Next.js встраивает `NEXT_PUBLIC_SITE_URL` в build artifact; одного runtime env
недостаточно для metadata, sitemap и robots. Compose поэтому fail-closed
требует `WEB_PUBLIC_URL` и передаёт его как
`NEXT_PUBLIC_SITE_URL` build arg только service `web`. Общий Web Dockerfile
превращает arg в env до `pnpm build`. Runtime `NEXT_PUBLIC_SITE_URL` остаётся
для согласованности запуска, но не исправляет artifact, собранный с неверным
origin. Admin build намеренно не получает этот public Web arg.

## Admin shell: только internal

Текущий `platform-admin` — unauthenticated shell с демонстрационными данными,
а не готовая operator surface. Compose может запускать его только в сети
`internal` для build/runtime smoke; `expose: 3002` не является host publish и
не разрешает внешний ingress. Service намеренно не подключён к `edge`.

Запрещено добавлять `ADMIN_PUBLIC_URL`, Dokploy/Traefik domain, edge network
или host port binding до реализации отдельной operator authentication
session/audience, обязательной 2FA, platform-role authorization, audit
опасных действий и server-backed non-demo данных. До прохождения этих gates
Admin origin также запрещено добавлять в Platform API `CORS_ORIGINS` и
Realtime `WEB_ORIGINS`; текущий Compose разрешает только `WEB_PUBLIC_URL`.
Фальшивая auth-заглушка не является основанием для внешней публикации.

## Dedicated Jobs → Platform API rank grant boundary

`JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` защищает internal issuer endpoint
execution grant. Это отдельный случайный service credential длиной не менее
32 символов; он обязан отличаться от `INTERNAL_API_TOKEN`, rank manifest/result
tokens, credential-vault и notification tokens, encryption keys и provider
credentials.

Compose передаёт этот secret ровно двум process types: HTTP-процессу
`platform-api`, который валидирует запрос и сохраняет immutable решение, и
отдельному `rank-worker`, где bounded Jobs client проверяет exact response, а
Jobs-owned fail-closed boundary до HTTP сохраняет immutable `REQUESTED` intent,
повторяет только exact request с тем же idempotency key и фиксирует
`DENIED`, `EXPIRED`, `GRANTED_PENDING_CONSUME` либо `REJECTED_LOCAL`.
Валидный grant атомарно получает `CONSUMED` только вместе с secret-free
scoped `rank_connector_executions/READY_TO_SUBMIT`; credential material и
provider request не создаются. SECURITY DEFINER connector claim и provider
submit пока не реализованы, production submit остаётся явно выключенным.
Jobs HTTP, connector/import/inspection/system workers, migrations и остальные
сервисы secret не получают. Передача через общие anchors запрещена.

Корневой `.env.example` оставляет значение пустым намеренно: перед первым
deploy оператор создаёт новый URL-safe secret в secret storage Dokploy.
Секрет нельзя писать в Git, URL, логи, traces, queue/event payload или
диагностические artifacts. Ротация требует согласованной замены secret и
redeploy всех реплик `platform-api` и `rank-worker`.

## Dedicated Jobs → SEO Data rank boundary

`JOBS_TO_SEO_RANK_TOKEN` защищает внутренние операции immutable rank
manifest и чтение их plaintext chunks. Это отдельный случайный service
credential длиной не менее 32 символов. Он обязан отличаться от
`INTERNAL_API_TOKEN`, credential-vault token, notification token, encryption
keys и provider credentials.

Compose передаёт этот secret ровно двум process types:

- HTTP-процессу `seo-data`, который валидирует rank manifest boundary;
- отдельному `rank-worker` из image `platform-jobs-integrations`, который
  выполняет `dist/rank-worker.main.js` (`start:worker:rank`).

Его не получают `jobs-integrations`, `system-worker`, `import-worker`,
`upload-inspection-worker`, `connector-worker`, migrations, Platform API,
Realtime, Web и Admin. Наличие переменной в Dokploy project environment не
означает её передачу контейнеру: контейнер получает secret только через
явную запись в своём `environment`. Добавлять token в общие anchors
`x-common-backend-env` или `x-jobs-env` запрещено.

### Rank-worker process

`rank-worker` использует тот же production image, что Jobs HTTP, но имеет
отдельный command и минимальный allowlist конфигурации:

- `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_URL`;
- `PLATFORM_API_URL`, `PLATFORM_API_COMMAND_TIMEOUT_MS`;
- `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN`;
- `SEO_DATA_URL`, `SEO_DATA_COMMAND_TIMEOUT_MS`;
- `RANK_PREPARATION_ENABLED=true`;
- `JOBS_TO_SEO_RANK_TOKEN`;
- `RANK_PREPARATION_LEASE_SECONDS`,
  `RANK_PREPARATION_DISPATCH_SECONDS`,
  `RANK_PREPARATION_CONCURRENCY`;
- `INTEGRATION_CREDENTIAL_ROLE=DISABLED`.

Процесс не получает `INTERNAL_API_TOKEN`, credential management/execution
keyrings, NATS, S3 или SMTP credentials. Он подключён только к сети
`internal`, не имеет `ports`/`expose` и не получает маршрут `outbound`.
Startup ждёт успешную Jobs migration, здоровые Redis, `seo-data` и
`platform-api`.
Container healthcheck проверяет только liveness entrypoint; operational
readiness определяется queue lag, lease recovery и dependency metrics.

Для первой VPS установлены консервативные defaults: pool `10`, concurrency
`2`, `1 CPU`, `512M` RAM и `128` PID. Они настраиваются через
`JOBS_RANK_DATABASE_POOL_MAX`, `RANK_PREPARATION_*`,
`JOBS_RANK_CPU_LIMIT`, `JOBS_RANK_MEMORY_LIMIT` и
`JOBS_RANK_PIDS_LIMIT`. Concurrency увеличивается только после проверки
PostgreSQL/Redis/SEO Data saturation. Lease обязан превышать
`SEO_DATA_COMMAND_TIMEOUT_MS` минимум на пять секунд; runtime проверяет этот
инвариант fail-closed. Grant client использует отдельный bounded
`PLATFORM_API_COMMAND_TIMEOUT_MS` с default `5000`; URL Platform API в
Compose фиксирован внутренним `http://platform-api:4000` и не управляется
операторским input.

Пошаговый rollout, безопасная проверка и rollback описаны в
[`runbooks/jobs-to-seo-rank-token.md`](./runbooks/jobs-to-seo-rank-token.md).
Инвариант получателей проверяется без раскрытия значения:

```bash
node --test tests/*.test.mjs
```

## Dedicated SEO Data result и cursor boundaries

`JOBS_TO_SEO_RANK_RESULT_TOKEN` защищает отдельный write boundary для уже
нормализованных rank results. Preparation worker с
`JOBS_TO_SEO_RANK_TOKEN` читает manifest/chunks, но не должен получать право
записывать observations; result producer, наоборот, не должен получать
plaintext chunks через result credential. Поэтому preparation и result
tokens всегда генерируются независимо и не могут иметь одинаковое значение.
В текущем Compose result token получает только HTTP-процесс `seo-data`.
Будущий result worker можно добавить вторым явным получателем только вместе с
review и обновлением scope regression test; передавать token через общий
anchor запрещено.

`RANK_HISTORY_CURSOR_KEY` — отдельный HMAC-SHA-256 key для аутентификации
непрозрачных rank-history cursors. Его получает только `seo-data`; worker,
migration и остальные API не должны его видеть.

Оба значения генерируются случайно, имеют длину не менее 32 символов и должны
отличаться друг от друга, `JOBS_TO_SEO_RANK_TOKEN`, `INTERNAL_API_TOKEN`,
остальных service credentials, encryption/fingerprint keyrings и provider
credentials. Пустые строки в `.env.example` — намеренный fail-closed
предохранитель: перед первым deploy оператор обязан создать новые значения в
secret storage Dokploy.

Ротация result token сейчас выполняется заменой secret и redeploy всех
реплик `seo-data`, поскольку result producer в этом Compose ещё не запущен.
После появления producer single-token boundary требует короткой остановки и
drain result writes, одновременного обновления producer и всех реплик
`seo-data`, authenticated smoke test и только затем возобновления очереди.
Повторно использовать preparation token как временный fallback запрещено.

Ротация cursor key инвалидирует все ранее выданные cursors. Её проводят в
окно обслуживания: завершают или останавливают активную pagination, не
допускают одновременной работы реплик с разными keys, обновляют все реплики
`seo-data` и проверяют, что новый cursor проходит следующий page request.
Клиент с прежним cursor должен начать pagination заново без cursor; откат
key после выпуска новых cursors создаст ту же инвалидацию в обратную сторону.

Ни один из этих secrets нельзя писать в Git, тикеты, URL, логи, traces,
exception messages, queue/event payloads или диагностические artifacts.
Команда `docker compose config` раскрывает подставленные значения, поэтому для
проверки конфигурации используется только `docker compose ... config --quiet`;
полный rendered config нельзя печатать в CI logs или прикладывать к incident.

## BYOK vault и ротация ключей

`INTEGRATION_CREDENTIAL_KEYS` — отдельный от auth версионируемый набор
master keys (KEK) для BYOK-секретов. Сгенерировать первое значение можно
командой
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`
и записать как `1:<значение>`, установив active version `1`.
`INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS` — второй независимый
версионируемый keyring для keyed request fingerprints. Для него нужно
сгенерировать другое случайное значение той же длины; KEK повторно
использовать запрещено.
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN` — отдельный service credential для
этого vault. Он должен отличаться от `INTERNAL_API_TOKEN` и передаётся только
`platform-api` и HTTP-процессу `jobs-integrations`; generic workers,
realtime, seo-data и migration services его не получают.

Compose передаёт полный management keyring только HTTP-процессу
`jobs-integrations`. Migration service, `system-worker`, `import-worker` и
`upload-inspection-worker` не получают `INTEGRATION_CREDENTIAL_*` и запускаются
с ролью `DISABLED`. `connector-worker` получает только роль `EXECUTION`,
encryption KEK и его active version: fingerprint keyring и dedicated
management token ему намеренно недоступны. Общий `INTERNAL_API_TOKEN` и
учётные данные NATS этому процессу также не передаются.
Runtime config guard подтверждает это fail-closed: роль `DISABLED` не стартует
при наличии credential secrets, а `EXECUTION` отклоняет
management/fingerprint/internal/NATS и S3/SMTP secrets. Guard уменьшает риск
ошибочной доставки секретов, но не заменяет process/database/KMS isolation.
Даже процесс с общим internal token не может вызвать list/create/rotate/revoke
credential: эти endpoints принимают только dedicated caller token.

`JOBS_CONNECTOR_DATABASE_USER` и `JOBS_CONNECTOR_DATABASE_PASSWORD` задают
отдельную PostgreSQL-роль без superuser, role membership и ownership объектов
кластера; скрипт не выдаёт ей `CREATE`, `INSERT` или `DELETE`. Пароль
генерируется URL-safe, например в base64url, потому что Compose подставляет
его в DSN. После jobs migration одноразовый сервис
`jobs-connector-db-permissions` идемпотентно создаёт/ужесточает роль и выдаёт
`CONNECT` к `jobs_db`, `USAGE` на `public`, `SELECT` всех строк и колонок
таблиц `jobs` и `integration_credentials`, а также `UPDATE` явно перечисленных
колонок состояния. Это ограничивает DML, но **не** обеспечивает tenant/secret
isolation: компрометированный execution process может прочитать job
snapshots/metadata всех tenants и все encrypted credential rows, а вместе с
KEK — весь BYOK vault этого database. Привилегированную существующую роль,
роль с membership или ownership объектов скрипт fail-closed использовать
отказывается; прежние прямые grants вне `jobs_db` и наследуемый через
`PUBLIC` доступ требуют отдельного cluster-wide privilege audit.

До production широкий read grant является release blocker. Нужны отдельная
узкая execution projection/table со scope, который проверяется на стороне БД,
либо credential broker/KMS, не позволяющий execution login читать весь vault.
Дополнительно обязательны fresh non-owner role provisioning, cluster-wide
grant audit и `pg_hba`/отдельный cluster boundary. Называть текущую роль
tenant-isolated или least-read до этого запрещено.

Нормативный grant-скрипт:
`postgres/permissions/jobs-connector.sql`. `connector-worker` запускается
только после его успешного завершения. HTTP-процесс и migration продолжают
использовать основную роль сервиса, а execution worker не получает её пароль.
После каждой migration проверяется diff требуемых worker-запросов: добавлять
широкие `ALL TABLES`, default privileges или права изменения ciphertext
запрещено.

Каждый credential шифруется envelope-схемой:

- случайный 256-bit data encryption key (DEK) шифрует payload через
  AES-256-GCM;
- active KEK шифрует DEK; в PostgreSQL сохраняются только ciphertext,
  encrypted DEK, отдельные nonce/auth tag и версия KEK;
- AAD payload связывает ciphertext с workspace, provider и credential ID;
  AAD обёрнутого DEK дополнительно включает версию KEK;
- plaintext secret и незашифрованный DEK в PostgreSQL, queue payload, audit,
  events и logs не сохраняются.

Startup credential-capable процесса проверяет формат keyring, наличие active
version и соответствующих 32-byte keys. Management-процесс до открытия HTTP
агрегированно сверяет все `key_version` и `fingerprint_key_version`
неудалённых credentials с PostgreSQL; execution worker сверяет только
`key_version`, затем до создания BullMQ worker расшифровывает один
детерминированный минимальный по UUID неудалённый sample каждой используемой
версии через штатный execution adapter. Проверяются оба AES-GCM auth tag и
точный workspace/provider/credential/version AAD; пустой vault допустим.
Missing/corrupt sample завершает startup fail-closed, а ошибка содержит только
номер версии. Management plaintext не расшифровывает. Перед каждым rollout
дополнительно получить безопасные счётчики:

```sql
SELECT 'encryption' AS keyring, key_version AS version,
       count(*) AS credential_count
FROM integration_credentials
WHERE deleted_at IS NULL
GROUP BY key_version
UNION ALL
SELECT 'fingerprint' AS keyring, fingerprint_key_version AS version,
       count(*) AS credential_count
FROM integration_credentials
WHERE deleted_at IS NULL
GROUP BY fingerprint_key_version
ORDER BY keyring, version;
```

Каждая версия должна присутствовать в соответствующем keyring. Отображение
`keyVersion → key bytes` immutable: однажды выпущенной версии запрещено
присваивать новое значение. Для нового key material всегда создаётся новая
версия. Значения самих ключей нельзя выводить в CI logs, тикеты или результаты
`docker compose config`.

Ротация KEK выполняется с overlap:

1. Сгенерировать новую уникальную версию и добавить её рядом со старой, не
   меняя active version.
2. С прежней active version развернуть расширенный keyring одновременно в
   management `jobs-integrations` и во **всех** репликах `connector-worker`.
3. Startup canary/verifier должен выполнить безопасную authenticated
   расшифровку canary каждой используемой версии во всех новых replicas.
   Проверки только номера версии или длины ключа недостаточно.
4. После успешной canary-проверки drain-ить старые replicas и убедиться, что
   они больше не исполняют jobs.
5. Только после подтверждения шагов 2–4 переключить active version в
   management process и синхронизировать конфигурацию connector replicas.
   Новые и заменённые credentials начнут использовать новый KEK.
6. Идемпотентно и ограниченными batch переобернуть только encrypted DEK
   существующих записей, обновляя `key_version`; payload расшифровывать и
   переписывать не требуется.
7. Повторять coverage query до нулевого числа активных записей на старой
   версии. Старый KEK удалить только после этого, завершения rollback window и
   проверки политики encrypted backups.

Автоматический bounded DEK rewrap ещё не реализован. До его появления шаг 6
не выполняется вручную, старый KEK не удаляется, startup coverage и SQL выше
остаются обязательными проверками. Для rollback достаточно вернуть прежнюю
active version, пока обе версии находятся в keyring; откат БД не требуется.
Если старая execution replica всё же встретит неизвестную `key_version`,
validation получает retryable platform error и не меняет статус credential.
Это страховка от отсутствующей версии при rollout race, а не проверка
правильности bytes и не замена обязательному expand-first шагу.

Startup decrypt-canary реализован для каждой `EXECUTION` replica и обнаруживает
неверные bytes под существующей версией по authenticated persistent sample до
обслуживания jobs. Validation worker при любом последующем decrypt failure
делает только bounded job retry и не меняет credential status. Canary
проверяет по одной строке на версию, поэтому не является аудитом каждой записи;
cluster-wide circuit breaker и incident alert для runtime-всплеска ещё нужны.
Он также выполняется через текущий read grant и не снимает отдельный blocker
global vault isolation: до live provider execution остаются обязательны
SECURITY DEFINER projection/claim и отзыв прямого чтения vault.

Fingerprint keyring ротируется отдельно: старая и новая версии сначала
работают одновременно, затем active version переключается на новую. Старый
fingerprint key нужен, пока есть неудалённые записи с соответствующим
`fingerprint_key_version`: он проверяет повтор исходного create, но не
шифрует credential. Автоматическая bounded-инвалидация старых fingerprints
после idempotency retry window ещё не реализована, поэтому такую версию также
нельзя удалять, пока coverage не равен нулю.

При утрате используемого KEK credential-capable management/execution процесс
не стартует.
Восстановление требует вернуть точное значение KEK из защищённой копии
секретов. Если копии нет, нужен отдельный offline incident recovery/revoke
tool с security review; текущая сборка такого инструмента не содержит.
Удалять credentials или проекты и обходить startup guard вручную запрещено.
Остальные сервисы продолжают давать read-only доступ к уже сохранённым
результатам.

Текущая envelope migration рассчитана на пустую pre-release таблицу
`integration_credentials` и fail-closed останавливается, если находит записи.
Это защищает от молчаливого присвоения старым ciphertext неверной схемы.
Все DDL этой migration находятся в одной явной PostgreSQL-транзакции.
Если migration останавливается на окружении с реальными данными, записи нельзя
удалять: rollout отменяется, готовится отдельный expand/backfill/contract план,
а состояние Prisma migration восстанавливается через `prisma migrate resolve`
только после документированного recovery review.

PostgreSQL, Redis и NATS не публикуют порты наружу. В production рекомендуется
разделить credentials баз данных по сервисам; один кластер на старте сохраняет
изоляцию databases без лишней эксплуатационной нагрузки.

Jobs runtime processes подключены одновременно к изолированной сети
`internal` и отдельной непубликуемой сети `outbound`. Она нужна для S3, SMTP и
проверенных provider HTTPS endpoints: без неё Docker `internal: true` не даёт
контейнеру маршрут в интернет. Ни один порт worker через `outbound` не
публикуется. Connector-код принимает только фиксированные HTTPS origins
Keys.so/Arsenkin и запрещает redirects; для high-assurance production
дополнительно нужен host firewall или egress proxy с DNS/hostname allowlist.

Для official PostgreSQL 18 volume намеренно смонтирован в
`/var/lib/postgresql`: начиная с 18 это новый persistent volume root. Не
возвращать старый путь `/var/lib/postgresql/data`.

`AUTH_*_COOKIE_NAME` должны быть одинаковыми у `web` и `platform-api`.
Имя CSRF cookie встраивается в browser bundle на build, поэтому его изменение
требует пересборки Web. Содержимое cookie, access token и session token в
frontend bundle не попадают.

## Подключение S3 и email

Для application uploads заполнить `S3_*` и включить `S3_ENABLED=true`.
Directus можно перевести на тот же S3-провайдер с отдельным bucket:
`DIRECTUS_STORAGE_DRIVER=s3`, `S3_BUCKET_CMS=...`.

Application bucket должен разрешать CORS только с origin основного Web:

- методы `PUT`, `GET`, `HEAD`;
- request headers, используемые S3-подписью;
- response header `ETag` в `ExposeHeaders`;
- короткий `MaxAgeSeconds`, соответствующий политике провайдера.

Wildcard origin с credentials запрещён. Signed URL передаётся только клиенту,
не логируется и истекает по `S3_SIGNED_URL_TTL_SECONDS`. Для bucket обязательно
настроить lifecycle: abort incomplete multipart uploads через 2 дня и
retention/удаление quarantine и временных объектов по продуктовой политике.
Периодический reconciliation job дополнительно закрывает просроченные записи
и orphan objects; bucket lifecycle остаётся последней линией защиты.

Для писем приложения заполнить SMTP-переменные и включить
`EMAIL_ENABLED=true`. Для Directus дополнительно установить
`DIRECTUS_EMAIL_TRANSPORT=smtp`. До этого оба контура остаются работоспособными,
но не отправляют письма.

## Регистрация browser Web Push

HTTP lifecycle browser-устройств включается отдельно от фактической доставки:

- `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN` — отдельный случайный секрет
  длиной не менее 32 символов только для `platform-api` и `realtime`; он не
  должен совпадать с `INTERNAL_API_TOKEN`;
- `WEB_PUSH_VAPID_PUBLIC_KEY` и его immutable
  `WEB_PUSH_VAPID_KEY_VERSION` описывают только публичный application server
  key;
- `WEB_PUSH_ENDPOINT_ORIGINS` — точный allowlist публичных HTTPS origins push
  services без path, credentials, IP-адресов и нестандартных портов;
- `WEB_PUSH_SUBSCRIPTION_KEYS` — versioned AES-256-GCM keyring формата
  `version:base64url-32-byte-key`;
- `WEB_PUSH_FINGERPRINT_KEYS` — отдельный versioned HMAC-SHA-256 keyring того
  же формата; material нельзя переиспользовать между keyrings;
- active версии задаются через
  `WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION` и
  `WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION`;
- `WEB_PUSH_MAX_ACTIVE_DEVICES` по умолчанию ограничивает пользователя
  двадцатью активными browser installations.

Значение `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN` в `.env.example`
намеренно пустое, поэтому Compose fail-closed не запустится без явной
настройки. Сгенерировать URL-safe secret можно командой:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Сначала развернуть миграцию, полный набор keyrings и dedicated token с
`WEB_PUSH_REGISTRATION_ENABLED=false`. Текущий startup guard сверяет номера
версий, но не bytes: включать регистрацию в production до persistent
authenticated canary/verifier запрещено. В staging после ручной проверки
immutable key material и coverage переключить только `realtime` на `true`.
Отображение `version → key bytes` immutable; ротация выполняется
expand-first, старую версию нельзя удалять,
пока она используется активными строками. Fingerprint rotation требует
одинакового overlap keyring на всех Realtime replicas: сначала расширить
keyring везде, затем drain старых replicas и только после этого переключить
active version. Partial unique index защищает один digest, но не разные HMAC
digests одного endpoint под разными версиями ключа.

VAPID private key намеренно отсутствует в текущих HTTP/API/Web process и в
этом Compose. Он будет принадлежать отдельному sender process после включения
durable delivery. Пока `deliveryAvailable=false` и
`testDeliveryAvailable=false`: регистрация, переименование и отзыв устройства
не означают, что внешняя доставка работает. Production-зависимости
`@nats-io/jetstream` и `web-push` ещё не одобрены.

## Проверка загружаемых файлов

Production upload pipeline запускается Compose profile `inspection`. Он
добавляет официальный ClamAV container и отдельный
`upload-inspection-worker`; TCP 3310 остаётся только во внутренней сети.
Сигнатуры ClamAV сохраняются в volume `clamav_data`, поэтому первый cold start
может занимать несколько минут.

В Dokploy нужно включить profile `inspection` одновременно с
`S3_ENABLED=true`. Scanner работает fail-closed: если ClamAV или S3 временно
недоступны, API продолжает обслуживать приложение и просмотр данных, но файл
остаётся `UPLOADED` и повторно ставится в очередь. Статус `READY` без полного
потокового сканирования невозможен.

ClamAV требует заметного отдельного memory budget; для первого VPS следует
планировать около 4 GiB только на scanner/signature database и начинать с
`UPLOAD_INSPECTION_CONCURRENCY=1` или `2`. При нехватке памяти inspection
worker и ClamAV лучше вынести на отдельную VPS, не меняя API и схему данных.
Для rejected objects в S3 обязательны quarantine retention и lifecycle
cleanup; публичные download/import endpoints их не выдают.

## Потоковый импорт CSV/TSV

`import-worker` запускается как отдельный process type из image
`jobs-integrations` и не зависит от HTTP API по памяти или времени выполнения.
Он читает только uploads со статусом `READY`, потоково разбирает CSV/TSV,
сохраняет строки в partitioned staging `jobs_db`, валидирует подтверждённое
сопоставление и публикует уникальные строки чанками через internal HTTP
`seo-data`. Его concurrency и размеры batch задаются
`IMPORT_PARSE_CONCURRENCY`, `IMPORT_STAGING_BATCH_ROWS` и
`IMPORT_PUBLISH_BATCH_ROWS`.

Вызовы jobs → `seo-data` используют `SEO_DATA_URL`, общий
`INTERNAL_API_TOKEN`, trusted tenant/actor headers и отдельный timeout
`SEO_DATA_COMMAND_TIMEOUT_MS`. Jobs не получает доступ к `seo_db`.
Повтор chunk безопасен благодаря receipt/payload hash; рестарт после
кооперативной отмены завершает partial semantic version.

На первой VPS следует начинать с concurrency `1`–`2`. Worker имеет
lease/heartbeat и периодически возвращает в очередь зависшие parsing jobs,
поэтому рестарт контейнера не требует ручного восстановления. XLSX/ZIP/XLS
подключаются отдельными изолированными parser adapters; до их включения
jobs API fail-closed отклоняет запуск неподдерживаемого формата.

## Масштабирование

API, SEO data, jobs API, workers, realtime и Next.js stateless на уровне
контейнера. Реплики worker/realtime можно увеличивать независимо. Persistent
state находится в PostgreSQL, Redis, NATS JetStream и S3. Перед production
нужны внешние backups, alerting и проверенный restore runbook.

`platform-web` является одним repository/image. При росте одно image можно
запустить отдельными public/app runtime profiles и направить `/app` в
изолированный pool через Traefik, не возвращаясь к двум расходящимся frontend.
