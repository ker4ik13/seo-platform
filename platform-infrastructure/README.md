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
   Пароли PostgreSQL для bootstrap administrator, четырёх migration owners,
   четырёх runtime roles, Directus и connector должны быть независимыми,
   URL-safe и длиной не менее 32 символов.
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
5. Развернуть compose. Role bootstrap завершается до migrations, migrations —
   до post-migration grants, а application processes стартуют только после
   успешного privilege provisioning.

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

## PostgreSQL service roles и ownership rollout

`POSTGRES_USER` является только cluster bootstrap administrator. Его пароль не
передаётся migrations или application processes. Compose использует
фиксированное отображение:

| Database | Migration owner | Application runtime |
|---|---|---|
| `platform_db` | `platform_owner` | `platform_runtime` |
| `seo_db` | `seo_owner` | `seo_runtime` |
| `jobs_db` | `jobs_owner` | `jobs_runtime` |
| `realtime_db` | `realtime_owner` | `realtime_runtime` |

Одноразовый `service-database-roles` создаёт эти роли без superuser,
`CREATEDB`, `CREATEROLE`, inheritance, replication, `BYPASSRLS` и membership,
устанавливает SCRAM verifiers через stdin и закрепляет каждую database за её
canonical owner. Затем Prisma выполняется только owner-ролью. Отдельные
`*-runtime-db-permissions` после migrations выдают runtime только `CONNECT`,
`USAGE`, обычный CRUD без `TRUNCATE` и sequence usage в собственной database;
`_prisma_migrations`, DDL, extensions, роли и чужие databases недоступны.
Default privileges владельца сохраняют эту границу для будущих tables и
sequences, а будущие routines остаются private до внесения в точный allowlist.

`pg_trgm` является trusted extension, но его member functions в PostgreSQL
остаются принадлежащими bootstrap superuser. Поэтому
`seo-extension-db-permissions` — отдельный audited superuser one-shot: он
принимает только extension `pg_trgm`, отзывает `PUBLIC EXECUTE` и выдаёт exact
extension-function access только `seo_runtime`. Расширять этот allowlist без
review запрещено.

Directus сейчас самостоятельно применяет собственные schema migrations при
старте. Для `directus_db` поэтому используется явно названное исключение
`directus_runtime_owner`: одна combined owner/runtime роль может выполнять DDL
только в `directus_db`, не имеет membership или cluster privileges и не может
подключиться к service databases. После появления отдельного поддерживаемого
Directus migration/snapshot deploy step исключение должно быть разделено на
owner/runtime тем же способом.

Generated first-match HBA сначала разрешает каждой canonical owner/runtime
role только её точную database по SCRAM, затем отклоняет replication, любую
другую database и stale family names до общих правил. Та же модель действует
для `directus_runtime_owner` и `jobs_connector`. Это закрывает обход через
оставшийся в соседней database `PUBLIC CONNECT`; provisioning дополнительно
отзывает `PUBLIC` database/schema/object/default privileges в принадлежащей
сервису границе. Для PostgreSQL между VPS всё равно обязательны TLS и точный
source CIDR либо отдельный managed-cluster policy.

### Существующий PostgreSQL volume

Автоматически передаётся ownership только пустой legacy database. Если в ней
уже есть objects старого bootstrap owner, `service-database-roles` намеренно
останавливается: безопасно угадать происхождение всех объектов невозможно.
Rollout выполняется так:

1. остановить writers, сделать backup и подтвердить restore на отдельном
   PostgreSQL 18;
2. инвентаризировать database/schema/table/sequence/view/type/routine/
   extension owners, grants, default ACL и активные sessions отдельно для
   каждой из пяти databases;
3. на восстановленной копии подготовить и проверить явный object-by-object
   ownership handoff к canonical owner; не запускать широкий
   `REASSIGN OWNED` от общего bootstrap user без отдельного review;
4. повторить backup/check, применить утверждённый handoff в maintenance window,
   затем запустить role bootstrap → migrations → runtime/connector grants;
5. проверить `pg_hba_file_rules`, отсутствие membership/чужого ownership и
   реальные login smoke: своя database разрешена, соседняя и replication
   отклонены; только после этого возобновлять writers.

Fresh PostgreSQL 18 regression
`tests/service-database-role-isolation-postgres.test.mjs` применяет все 37
Prisma migrations, проверяет runtime CRUD, UUIDv7 и constraint routines, а
также отрицательные DDL/`_prisma_migrations`/cross-database/replication/
membership/ownership/`PUBLIC` сценарии, Directus exception и connector exact
allowlist. Тест разрешено запускать только на disposable fresh cluster:

```sh
SERVICE_DATABASE_ROLE_TEST_ADMIN_URL='postgresql://ADMIN:PASSWORD@HOST:PORT/postgres' \
  pnpm infra:test
```

Тест удаляет созданные canonical databases/roles при cleanup; production или
shared cluster в эту переменную передавать запрещено.

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

Compose фиксирует immutable username отдельной PostgreSQL-роли как
`jobs_connector`; ротируется только `JOBS_CONNECTOR_DATABASE_PASSWORD`.
Username override намеренно отсутствует, чтобы старая LOGIN-role не выпала из
HBA boundary после «ротации» имени. Роль не имеет superuser, role membership
или ownership объектов кластера; скрипт не выдаёт ей `CREATE`, `INSERT` или
`DELETE`. Пароль
генерируется URL-safe, например в base64url, потому что Compose подставляет
его в DSN. После jobs migration одноразовый сервис
`jobs-connector-db-permissions` идемпотентно создаёт/ужесточает роль и выдаёт
только `CONNECT` к `jobs_db`, `USAGE` на `public` и `EXECUTE` на точный набор
broker/claim функций. Прямые `SELECT/INSERT/UPDATE/DELETE` на `jobs`,
`integration_credentials`, synthetic canary и остальные таблицы отсутствуют.
Пароль роли устанавливается отдельным `psql \password`: SCRAM verifier
формируется клиентом, а cleartext передаётся только через stdin и не попадает
в SQL literal, аргументы процесса или psql history. Wrapper до запуска `psql`
удаляет password из inherited environment и хранит его только в non-exported
shell variable; та же `psql` session перед `\\password` принудительно задаёт
`password_encryption='scram-sha-256'`, поэтому legacy `PGOPTIONS` не может
понизить verifier до MD5.
Management-only функции покрытия keyring и регистрации canary execution-роли
также недоступны. Каждый выданный `SECURITY DEFINER` boundary использует
фиксированный `search_path`, полностью квалифицированные relation и повторно
проверяет tenant/state/version/lease на стороне БД. Rank claim остаётся
default-closed по versioned DB control и сам по себе не разрешает network.

Привилегированную существующую роль, любую роль на любой стороне membership
edge или с ownership объектов скрипт fail-closed использовать отказывается.
Grant DDL выполняется одной транзакцией и через `pg_shdepend/pg_database`
fail-closed отклоняет direct ACL роли в другой database/shared object либо вне
exact `jobs_db/public` allowlist, включая column/default ACL. Чужие databases
он не открывает и их ACL не переписывает. В текущей `jobs_db` catalog audit
дополнительно отклоняет унаследованный через псевдороль `PUBLIC` доступ:
любое effective `CREATE` или `USAGE` non-system schema блокирует provisioning,
поэтому не остаются лазейки через operators и новые object kinds. Скрипт отзывает
database/schema/object `PUBLIC` privileges только в принадлежащем Jobs schema
`public`.

Provisioning обязан запускаться той же PostgreSQL-ролью, которая применяет
Prisma migrations: owner `_prisma_migrations` и всех routines в `public`
проверяется fail-closed. И global, и `IN SCHEMA public` default ACL отзывают
`PUBLIC EXECUTE` у будущих functions/procedures и возможные `PUBLIC` grants у
будущих tables/sequences. Существующие functions и procedures закрываются
через `ALL ROUTINES`, после чего exact grants возвращаются только восьми
allowlisted functions.

Compose запускает PostgreSQL через
`postgres/config/start-postgres.sh`. Он fail-closed принимает только canonical
service и connector names, запрещает их совпадение с `POSTGRES_USER` и до
official entrypoint генерирует описанный выше first-match HBA. Поэтому старое
family-имя и смена database в DSN не обходят boundary даже при оставшемся в
соседней database `PUBLIC CONNECT`; ACL соседних сервисов не меняются.

Остаточные ограничения точны: текущий Compose использует `host`, а не
`hostssl`, и address `all`, потому что transport ограничен internal Docker
network; TLS/mTLS и source-CIDR должны добавляться при межхостовом PostgreSQL.
Внешний managed PostgreSQL обязан воспроизвести тот же порядок правил либо
выделить connector отдельный cluster. HBA действует по первому совпадению,
reload не завершает старые sessions, поэтому rollout требует restart/drain
connector replicas, проверки `SHOW hba_file`/`pg_hba_file_rules` и реальной
пары login smoke: `jobs_db` разрешён, соседняя database отклонена.
До первого rollout нужно отдельно найти прежние connector LOGIN-roles с
произвольными именами, не входящими в новую family, перевести их в `NOLOGIN`,
завершить старые sessions и только затем revoke/drop; автоматически угадывать
их provenance нельзя. После этого username не ротируется.

Fresh 19-migration PostgreSQL 18 regression с synthetic login, non-public/
cross-DB direct ACL, inherited PUBLIC schema, pre-existing procedure,
global/schema defaults и будущими function/table/sequence подтверждает SCRAM,
транзакционный fail-closed и exact allowlist. Отдельный temporary PostgreSQL 18
HBA harness подтвердил реальный allow `jobs_db` и reject соседней database без
direct grant. Широкий vault/table read grant больше не является частью
штатной connector-роли.

Нормативный provisioning wrapper:
`postgres/permissions/provision-jobs-connector-role.sh`; точный grant DDL —
`postgres/permissions/jobs-connector.sql`. Opt-in regression включается только
с disposable `JOBS_CONNECTOR_PERMISSION_TEST_DATABASE_URL` на базе `jobs_db`
и при необходимости явным `JOBS_CONNECTOR_PERMISSION_TEST_PSQL`. HBA e2e
дополнительно требует `JOBS_CONNECTOR_PERMISSION_TEST_EXPECT_HBA=true`;
cluster обязан быть одноразовым, потому что тест создаёт и удаляет canonical
role и synthetic stale family-role.
`connector-worker` запускается
только после его успешного завершения. Jobs HTTP/workers используют
`jobs_runtime`, migrations — `jobs_owner`, а execution worker не получает ни
один из этих паролей.
После каждой migration проверяется diff требуемых worker-запросов: добавлять
широкие `ALL TABLES`, разрешающие `PUBLIC` default privileges или права
изменения ciphertext запрещено.

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
   расшифровку canary всех configured и реально используемых versions во всех
   новых replicas. Это проверяет новый KEK до переключения active version;
   проверки только номера версии или длины ключа недостаточно.
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
обслуживания jobs. Replica передаёт broker не более 128 configured versions и
получает их объединение с versions, реально используемыми credentials, плюс
usage marker. Used-but-unconfigured и отсутствующий canary fail-closed видны
как отдельные строки; retired unused unrequested historical canary исключён.
Проверка выполняется через точный `SECURITY DEFINER` broker grant без прямого
чтения vault. Validation worker при любом последующем decrypt failure делает
только bounded job retry и не меняет credential status. Canary проверяет по
одной строке на версию, поэтому не является аудитом каждой записи;
cluster-wide circuit breaker и incident alert для runtime-всплеска ещё нужны.

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

PostgreSQL, Redis и NATS не публикуют порты наружу. Credentials database
owners, runtimes, Directus и connector уже разделены; один cluster на старте
сохраняет изоляцию databases через role ACL и first-match HBA.

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
