# Infrastructure / Dokploy

`compose.dokploy.yml` — первый удалённый контур. Он рассчитан на одну VPS:

- PostgreSQL 18 с отдельными databases для четырёх backend-контуров и Directus;
- Redis с AOF для BullMQ, Socket.IO и cache;
- NATS с JetStream;
- четыре NestJS API, отдельные system, inspection, import и connector workers;
- единый web (`/`, `/tools`, `/docs`, `/app`), admin и Directus;
- S3 и SMTP подключаются как внешние managed/hosted сервисы.

## Первый запуск

1. Создать в Dokploy Compose-проект из корня репозитория.
2. Скопировать переменные из корневого `.env.example`, заменить все
   `replace-me`, URL и версии юридических документов.
3. Сначала оставить `S3_ENABLED=false`, `EMAIL_ENABLED=false`,
   `DIRECTUS_STORAGE_DRIVER=local`.
4. Привязать основной домен к `web:3000`, остальные домены к `admin:3002`,
   `platform-api:4000`, `realtime:4003`, `directus:8055`.
5. Развернуть compose. Migration services завершаются до запуска приложений.

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
`key_version`. При недостающей версии процесс завершается fail-closed. Перед
каждым rollout дополнительно получить безопасные счётчики:

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

Startup decrypt-canary/verifier пока не реализован. Coverage guard видит
наличие `keyVersion`, но не обнаруживает ошибочную замену значения под
существующей версией; missing-version retry тоже от этого не защищает. До
production обязательны verifier и/или глобальный decrypt-failure circuit
breaker: всплеск authentication/decrypt failures одной версии должен
остановить execution и поднять incident, а не массово переводить валидные
credentials в `DISABLED`. До реализации этого барьера production-ротация KEK
запрещена.

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
