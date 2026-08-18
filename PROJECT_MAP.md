# Карта проекта

Актуально на 12 августа 2026 года.

Карта описывает текущее устройство репозитория. Нормативные требования
находятся в `docs/technical-spec/00-index.md`, архитектурные решения — в
`docs/adr`.

## 1. Deployable topology

В проекте ровно три прикладных deployable-сервиса:

| Сервис | Каталог | Назначение | Порты |
|---|---|---|---:|
| Frontend | `frontend` | единый Next.js: публичный сайт, `/app`, `/admin`, BFF | 3000 |
| Backend Core | `backend-core` | Platform API, SEO domain, Realtime, опциональный Web Push | 4000, 4001, 4003 |
| Backend Execution | `backend-execution` | Jobs API, очереди, импорт, rank/crawl/connectors, email | 4002 |

PostgreSQL, Redis, NATS, S3 и ClamAV — инфраструктурные зависимости, а
one-shot migration/permission/preflight containers — deploy steps. Они не
являются прикладными сервисами. Production-like Compose находится в
`infrastructure/compose.dokploy.yml`: восемь long-running containers при
включённом inspection profile и четырнадцать one-shot containers. Все
persistent local data используют named volumes; repository configs запекаются
в infrastructure image stages и не зависят от transient Dokploy checkout.

```text
browser ──> frontend ──> backend-core ──> backend-execution
               │              │                  │
               │              ├── NATS ──────────┤
               │              ├── PostgreSQL     ├── PostgreSQL
               │              └── Redis Realtime ├── Redis Jobs/BullMQ
               │                                 ├── S3
               └── same-origin BFF               └── provider APIs
```

Backend-компоненты запускают несколько изолированных child process roles из
одного artifact. Это сохраняет отдельные event loops и scoped environment,
но не требует отдельных Dokploy Applications.

После инфраструктурных one-shot шагов оба backend-компонента сходятся по
readiness совместно. `backend-execution` ждёт запуска контейнера
`backend-core`, но не его статуса `healthy`, потому что readiness Core сама
проверяет Execution; ожидание `service_healthy` с обеих сторон создало бы
startup deadlock. Frontend запускается только после полной readiness Core.
Внутри backend supervisors creator-роли Realtime HTTP и Jobs HTTP
регистрируют immutable Web Push/credential canaries. Изолированные sender и
connector roles при одновременном старте ограниченно ждут только отсутствующую
строку, не получают права создавать её и по истечении окна остаются
fail-closed; повреждённый canary или неверный key material не повторяются.

Перед первым Dokploy deploy `pnpm dokploy:env:generate` создаёт локальный
`.env.dokploy.generated` с уникальными DB/Redis/service secrets,
base64url-keyrings и согласованными NATS plaintext/bcrypt парами. Генератор не
перезаписывает файл и не выводит секреты; внешние доменные, SMTP и S3 значения
остаются явными placeholders. Для NATS hash он заранее удваивает `$`, чтобы
значение пережило dotenv rewrite Dokploy. Старые и новые версии Dokploy
по-разному экранируют такой transport value, поэтому preflight и NATS renderer
принимают как canonical `$2a$11$…`, так и точную transport-форму
`$$2a$$11$$…`, но перед проверкой и записью broker config всегда приводят её к
canonical bcrypt. Внутри Compose один variable name автоматически
переиспользуется нужными контейнерами. PostgreSQL service также передаёт тот же
`POSTGRES_PASSWORD` как libpq-переменную `PGPASSWORD`, потому что Compose
backup Dokploy запускает `pg_dump` внутри контейнера и не имеет отдельного
поля пароля; оператор указывает в четырёх backup jobs только пользователя и
имя базы.

## 2. Каталоги

| Каталог | Ответственность |
|---|---|
| `frontend` | Next.js routes, UI, `/app`, `/admin`, browser/server BFF helpers |
| `backend-core` | composition root и supervisor Core |
| `backend-core/modules/api` | identity, workspace/project/RBAC, billing, audit, public API orchestration |
| `backend-core/modules/seo` | semantics, project Markdown notes, pages, rank manifests/results/history, crawl snapshots |
| `backend-core/modules/realtime` | Socket.IO, session revoke, notifications и Web Push persistence |
| `backend-execution` | durable jobs, queues, imports, vault, provider/rank/crawl/frequency workers |
| `packages/contracts` | общие versioned HTTP/event/error contracts без бизнес-логики |
| `packages/process-supervisor` | запуск child roles, signal forwarding и env allowlists |
| `infrastructure` | Dokploy Compose, migrations, ACL/preflight, VPS runtime, monitoring/runbooks |
| `docs/technical-spec` | нормативное продуктовое и техническое ТЗ |
| `docs/adr` | принятые архитектурные решения и rollback paths |

Frontend-представление состояния фоновых операций централизовано в
`frontend/lib/operation-status-presentation.ts`: штатное ожидание асинхронного
ответа провайдера и ожидание его свободного слота не отображаются как ошибочный
«повтор».

Рабочая область семантики использует единый набор правых панелей: карточка
запроса показывает по одному последнему состоянию Яндекса и Google,
append-only историю самого keyword ID независимо от технического контекста и
проектную заметку. График ограничен 14 последними снимками по времени, поэтому
новый контекст не скрывает более ранние замеры. Для последнего XMLStock
замера каждого поисковика карточка читает отдельную immutable Top-10 проекцию
органических результатов: первые пять строк видны сразу, остальные — по
явному раскрытию. Целевой URL сравнивается с текущим ranking URL после
безопасной нормализации host/path; несовпадение обозначается отдельно и не
меняет сами данные замера. История отображает
текущую позицию и дельту, выделяет `not-found` отдельной осью и интерактивно
проецирует безопасные параметры замера (search source, provider, регион,
устройство, depth и время), не раскрывая provider request ID или raw result;
пять последних сгруппированных дат находятся под графиком, выбранные 14
снимков открываются в modal.
Таблица и карточка вычисляют изменение позиции относительно последнего
найденного `rank_snapshot` того же keyword ID и поисковика по всем техническим
контекстам. Для bounded lookup используется
`rank_snapshots_keyword_global_history_idx`; новый регион, устройство или
профиль съёма поэтому не превращает существующий запрос в «Новая».
Удаление сохранённого контекста съёма реализовано как обратимый soft-delete:
контекст исчезает из новых запусков, но не удаляет immutable execution
manifests, результаты или историю позиций.
Стрелки перемещают фокус по загруженным строкам, а Shift расширяет диапазон
выделения. Дерево групп поддерживает явный union от двух обычных групп без
продуктового верхнего лимита; текущая открытая группа уже входит в выбор,
поэтому Ctrl/Cmd+клик по
следующей сразу даёт две группы. Контекстное меню после экспорта показывает
однострочную базовую палитру и через versioned PATCH меняет цвет сразу у всей
выборки; изменение только цвета не переотправляет позицию. Тот же каталог
`frontend/lib/semantic-group-colors.ts` используется в диалогах создания и
изменения: увеличенные образцы идут второй строкой под ручным цветом. Обычные
группы создаются и переупорядочиваются отдельно от фиксированных позиций системных
групп, поэтому `Без группы` и `Корзина` не участвуют в вычислении позиции
обычных siblings; position обычной группы является неотрицательным safe
integer без продуктовой границы `1999`. Правый клик вне текущей мультивыборки
заменяет её выбранной группой, а правый клик внутри сохраняет batch scope.
Серверный cursor и filter hash привязаны ко всему набору; union принудительно
добавляет регулируемую колонку группы, а обычная плотность показывает под
запросом компактные теги без служебной подписи языка/отслеживания. Компактная
плотность оставляет одну строку и скрывает inline-теги. Настройки
колонок/представлений и журнал операций не
перезагружают layout. Прогресс rank/frequency остаётся серверным источником
истины, а браузер по изменению safe progress-проекции перечитывает уже
загруженные строки таблицы без full-page reload. Поиск применяет 300 ms
debounce и имеет одну явную очистку с безопасными внутренними отступами.
Фильтр тегов предлагает project-scoped активные значения, допускает
произвольную строку и регистронезависимо ищет по нормализованному имени;
серверная сортировка тегов выполняется до cursor pagination, оставляя строки
без тегов внизу. Сброс условий сохраняет текущую папку или union папок.
Сортировка по позиции также выполняется до cursor pagination и всегда делит
выборку на три устойчивых уровня: сначала текущие найденные позиции, затем
`not-found` с известной предыдущей позицией, после них запросы без единого
найденного замера. Направление сортировки меняет порядок чисел только внутри
первых двух уровней и не перемешивает их между собой.

Мастер съёма позиций умеет выбирать сохранённый профиль, раскрывать вложенное
дерево папок и materialize родительский scope вместе с потомками. В
`tracking_contexts.launch_profile` сохраняются только provider-neutral тип
выдачи и режим/UUID папок; SEO Data повторно подтверждает tenant ownership
каждой папки. Выбор сохранённого профиля восстанавливает его полный assignment
как актуальные `keywordId/text/version`, а «Новый контекст» сохраняет переданное
из таблицы выделение. Credential не сохраняется в профиле: UI хранит только
project-scoped локальное предпочтение точного credential ID, повторно проверяет
его среди актуальных подключений workspace, помечает ровно одно подключение и
предупреждает, если после прошлого запуска в выбранных папках появились новые
canonical keywords. Credential ID не попадает в публичный context/job summary.

Каталог подписок v4 публикует лимиты `5/2/5k/1`, `20/10/20k/5`,
`50/30/50k/15` и `100/100/unlimited/30` для
users/projects/keywords-per-project/concurrent-jobs. Папки не тарифицируются:
совместимое значение `foldersPerProject = 0` трактуется как отсутствие лимита.
Миграция переводит только неотменённые подписки на новую immutable plan
version, не удаляя периоды, балансы, платежи или ledger history.

Ручное добавление сохраняет checkbox «Не добавлять дубли» отдельно для каждого
проекта в пользовательском Web storage. Выключенный checkbox использует
`ADD_TO_GROUP`: существующая каноническая keyword identity получает ещё одно
обычное group membership вместо второй строки в `keywords`. Ответ различает
`LINKED_EXISTING` и обычный skip. Поэтому group/view scope дедуплицируется самим
keyword ID, rank/frequency provider вызывается один раз, а единый snapshot
виден во всех папках запроса.

Журнал rank/frequency получает immutable строки результата cursor-страницами
по 200 или 500 элементов через весь tenant-scoped boundary
`frontend → Platform API → Execution/Core SEO`. Modal подгружает страницы
автоматически при прокрутке, дедуплицирует их по immutable `sequence`, а active
refresh перечитывает хвостовой cursor. Поэтому крупный запуск не
материализуется целиком в одном HTTP-ответе и не упирается в старый
presentation-limit 1 000 строк.

Frontend имеет один обязательный canonical origin `WEB_PUBLIC_URL`. Он
передаётся в build и runtime как server-only configuration; metadata,
robots/sitemap, BFF Origin-проверки и абсолютные auth-refresh redirects не
выводят origin из внутреннего reverse-proxy request URL и не имеют публичного
loopback fallback. Опциональный exact hostname `WEB_WWW_REDIRECT_HOST`
также передаётся в web build/runtime, маршрутизируется на тот же frontend и
получает permanent `308` на
`WEB_PUBLIC_URL` с сохранением path/query; произвольный `Host` не влияет на
redirect target. `PLATFORM_API_INTERNAL_URL` задаётся отдельно и никогда не
выдаётся браузеру.

Browser BFF-клиент обрабатывает истечение короткого access token централизованно:
параллельные `401` объединяются в одну rotation через `POST /app/auth/refresh`,
после чего каждый исходный same-origin запрос повторяется не более одного раза
с новым CSRF token. Истинно завершённая refresh session остаётся terminal и не
порождает цикл повторов или ложную ссылку на настройку provider route.

Общий `app/(protected)/layout` владеет `AppShell`, поэтому sidebar и шапка
сохраняются при клиентской навигации, а активный раздел вычисляется из текущего
pathname. Presentation-only состояние сворачивания синхронизируется между
`localStorage` и несекретной cookie для корректного SSR; tenant/project cookie и
permission context при этом не изменяются. Project logo читается через
same-origin permission-scoped endpoint Core API: пользовательский upload имеет
приоритет, иначе bounded discovery выбирает наиболее качественный безопасный
favicon из HTML, manifest и стандартных путей сайта. Выбранные
workspace/project обозначаются заливкой строки без дублирующей галочки. Один
project-option renderer показывает logo как в открытом списке, так и в закрытом
значении sidebar, семантики и project-scoped экранов. Core API одним
агрегированным запросом получает из Execution число активных операций по
доступным проектам; ненулевое число отображается spinner/badge рядом с проектом
без раскрытия чужих project ID. В семантике кнопка «Операции» использует тот же
компактный индикатор. Persistent `AppShell` владеет единым tenant-scoped store,
который читает `GET /api/v1/workspaces/:workspaceId/operation-activity`,
обнуляет отсутствующие в authoritative projection проекты и обновляется по
visibility/focus, таймеру и локальному событию изменения операции. Все
селекторы и command bar читают одну карту; при временной недоступности Jobs
сохраняется последнее подтверждённое значение без ложного обнуления.

Остановка активной частотности или проверки позиций является двухшаговым
действием. Кнопки в карточке операции и header результата сначала открывают
малую warning-modal с безопасным default focus «Продолжить сбор»; cooperative
cancel отправляется только после явного подтверждения «Остановить». Уже
сохранённый прогресс при этом не удаляется. Отмена частотности не использует
устаревающую browser-версию Job: Execution атомарно применяет пустую
tenant/project-scoped команду только к текущему cancellable-состоянию. Для
проверки позиций повторная отмена идемпотентна; на стадиях
`CANCEL_REQUESTED` и `FINALIZING` кнопка не показывается, а гонка с началом
финализации возвращает authoritative состояние без пользовательской ошибки.

Защищённый `/admin` входит в тот же Frontend deployable. Раздел рабочих
областей ищет tenant по названию, slug, UUID, имени или email владельца и
показывает текущую subscription-проекцию. Роли `FINANCE` и `SUPER_ADMIN`
могут выдать ручную подписку на опубликованную версию тарифа не более чем на
пять лет; mutation требует recent MFA-сессию, CSRF, reason, точное
подтверждение workspace, optimistic precondition и стабильный idempotency key.
Ручная выдача не создаёт платёж/чек и атомарно очищает provider subscription и
default payment method, чтобы последующий автоплатёж не конфликтовал с
операторским решением.

Там же находятся read-only каталог проектов и глобальный журнал операций для
`SUPPORT`, `OPERATIONS` и `SUPER_ADMIN`. Core владеет project/workspace/user
identity и обогащает каталог авторами и владельцами; количество активных
ключей и пользовательских папок получает одним bounded internal-запросом из
SEO Data. При недоступности SEO Data каталог остаётся доступен, а счётчики
явно переходят в degraded state. Глобальный журнал формируется владельцем Jobs
в Execution, поддерживает bounded keyset pagination и фильтры по группе
состояний/типу; Core добавляет только display identity workspace, проекта и
автора запуска. Internal и browser contracts не содержат input/scope snapshot,
тексты ключей, provider payload и secrets — наружу выходит только состояние,
прогресс, allowlisted result metrics и нормализованный error code.

Старые каталоги `platform-*` и отдельный admin deployable удалены. Directus
удалён как не настроенная и не используемая runtime-зависимость; публичный
маркетинговый контент сейчас типизирован и хранится в `frontend/lib/content.ts`.

## 3. Архитектурные инварианты

- Tenant boundary — `workspace`; проект принадлежит ровно одному workspace.
- Browser входит через `frontend` и публичный API `backend-core`; переданный
  browser-ом workspace/actor context не считается доверенным.
- `backend-execution` не обращается к Core databases, Core — к `jobs_db`.
- До отдельного data cutover Core использует compatibility databases
  `platform_db`, `seo_db`, `realtime_db`; cross-database foreign keys нет.
- HTTP/event/error types не дублируются и находятся в `packages/contracts`.
- Core API вызывает SEO-модуль in-process; порт 4001 сохранён для совместимых
  внутренних callers из Execution.
- Между backend-компонентами используются scoped internal HTTP credentials;
  durable события проходят через transactional outbox/inbox и NATS JetStream.
- Долгие операции являются PostgreSQL-owned Jobs. BullMQ передаёт минимальный
  идентификатор и не является источником истины.
- Provider-команды идемпотентны; неопределённый результат платного submit не
  повторяется автоматически.
- Secrets не попадают в API, URL, логи, события или queue payload.
- WebSocket не является источником истины.
- Изменение data ownership или межкомпонентной границы требует ADR.

## 4. Runtime entrypoints

### `frontend`

- `next start` обслуживает public routes, `/app`, `/admin` и BFF routes в
  одном процессе.
- публичный `/tools` является landing без anonymous runners; рабочий каталог
  `/app/tools` содержит только реализованный project workflow проверки HTTP.
- `lib/server-runtime-origin.ts` валидирует canonical `WEB_PUBLIC_URL` и
  внутренний Platform API origin; production web origin обязан использовать
  HTTPS и не может быть локальным именем.

### `backend-core`

- `src/main.ts` — supervisor;
- `src/core.main.ts` — Platform API + in-process SEO, порты 4000/4001;
- `src/realtime.main.ts` — Realtime HTTP/WebSocket, порт 4003;
- `src/web-push-worker.main.ts` — опциональная Web Push delivery role.

### `backend-execution`

- `src/main.ts` — supervisor;
- `src/http.main.ts` — Jobs/internal HTTP, порт 4002;
- `src/worker.main.ts` — Redis-only system dispatcher;
- `src/import-worker.main.ts` — semantic import, keyword-research import и
  streaming semantic export через отдельные очереди `semantic-import` и
  `exports`;
- `src/rank-worker.main.ts` — параллельные rank preparation/grant/result;
- `src/crawl-worker.main.ts` — technical crawl;
- `src/connector-worker.main.ts` — provider I/O и credential broker с
  независимыми очередями `rank-connector-runtime`,
  `frequency-collection-runtime`, `keyword-research-runtime` и
  `integration-credential-validation`;
- `src/inspection-worker.main.ts` — опциональная malware inspection;
- `src/auth-email-worker.main.ts` — опциональная transactional email delivery.

Supervisor передаёт каждому child process только разрешённые переменные. DB,
Redis, NATS, SMTP, vault и provider capabilities остаются раздельными на
уровне процессов; container-level secret boundary соответствует одному из
двух backend deployables. Rank и connector roles запускаются несколькими
child processes (`RANK_WORKER_PROCESSES`, `CONNECTOR_WORKER_PROCESSES`), но
не являются отдельными deployable-сервисами. Connector runtime dispatch
работает отдельным быстрым тиком (по умолчанию 1 секунда), а credential
maintenance сохраняет собственный медленный интервал. Одноузловой VPS runtime
запускает три connector child process, совпадая с production default Compose.
Arsenkin DB broker
сохраняет общий bounded task capacity и lease fencing между всеми процессами.
XMLStock HTTP ограничивается распределёнными Redis buckets по
`credentialId + product` (`YANDEX_LIVE`, `GOOGLE_LIVE`,
`YANDEX_SEARCH_API`, `WORDSTAT`): разные API-ключи не блокируют друг друга,
один ключ делит лимит между своими проектами. Permit удерживает только внешний
HTTP, не `POLL_WAIT`; throttling адаптивно уменьшает окно. Состояние limiter
хранится только в connector ACL namespace
`seo-platform:jobs:v1:provider-rate-limit:*`. PostgreSQL fair claim
предпочитает менее занятую пару credential/project, оставаясь source of truth
для Job, lease и progress.

## 5. Владение данными

| Данные | Модуль-владелец | Текущее хранилище |
|---|---|---|
| users (включая bounded account avatar до 512 KiB), sessions, workspaces (включая bounded workspace avatar до 512 KiB), projects и bounded project logos до 512 KiB, project transfer requests, RBAC, billing, audit, platform admin command receipts | Core API | `platform_db` |
| semantics (включая keyword notes и presets минус-слов), project Markdown notes, pages, rankings и immutable XMLStock Top-10 SERP results, crawl/page-map projections | Core SEO | `seo_db` |
| realtime subscriptions, deliveries, event inbox | Core Realtime | `realtime_db` + Redis |
| jobs, schedules, uploads, credential vault, provider execution | Execution | `jobs_db` + Redis + S3 |

У каждой Prisma schema своя migration history. Migration owner и application
runtime roles разделены. Сложные PostgreSQL primitives (`COPY`, partitioning,
specialized indexes, bounded claim/broker functions) остаются параметризованным
SQL в repository/permission boundaries; обычный CRUD выполняется через Prisma.
Unsafe Prisma raw APIs запрещены статическим тестом.

## 6. Ключевые потоки

### Ручной съём позиций и Top-100

1. Frontend запрашивает estimate через Core.
2. Execution фиксирует immutable snapshot binding/route/credential versions.
3. Rank role создаёт sealed manifest в Core SEO.
4. Core повторно проверяет lifecycle, RBAC и BYOK entitlement и выдаёт
   короткий grant. Внутренней дневной квоты на BYOK rank нет; статус estimate
   — `UNLIMITED`.
5. Connector role выполняет fenced submit/poll/get через DB broker.
6. Rank role публикует normalized chunks и terminal result; для XMLStock тот
   же hash-bound chunk содержит не более первых десяти нормализованных
   organic URL без raw response, Core SEO сохраняет их дочерними immutable
   строками rank snapshot; frontend читает только tenant-scoped projection.

XMLStock Google Top-100 собирается десятью последовательными страницами по 10
результатов; XMLStock Yandex Live использует такой же GET-only page mapping,
тогда как Yandex Search API остаётся submit/check. Для Live каждая успешно
оплаченная страница сохраняется в hash-проверяемом secret-free checkpoint в
`jobs_db`; следующий poll запрашивает ровно следующую страницу, а временный
429/5xx повторяет только текущую страницу. Поэтому сбой на второй–десятой
странице не теряет уже собранный Top и не создаёт повторную оплату за него.
Poll/recovery остаётся lease-fenced и bounded (до 720 попыток), чтобы
permanent provider failure не превращался в бесконечный платный цикл.
Просроченный grant, для
которого provider submit не начинался, не блокирует Job: rank dispatcher
создаёт новый execution attempt, сохраняя старую попытку как immutable audit.
Progress/finalization выбирает последнюю execution attempt для каждого
manifest chunk, поэтому сохранённая audit history повторов не увеличивает
ожидаемое число chunks и не блокирует terminal state.
Если Job всё же завершился `PARTIALLY_COMPLETED`, команда
`retry-missing` создаёт immutable child Job с `parent_job_id`. Core SEO сам
выбирает только entries родительского `CLOSED` manifest без `rankSnapshot` и
повторно проверяет текущий project/context/configuration; браузер не передаёт
keyword IDs. Child получает отдельный пяти минутный estimate на точное число
оставшихся entries и актуальное подтверждение неизменившегося credential
material; построение этого snapshot изолировано в
`rank-continuation-estimate.ts`. Уникальный partial index разрешает только
одного прямого child на parent, а exact `Idempotency-Key` возвращает уже
созданное продолжение.
Arsenkin provider-task capacity считает только execution текущего `RUNNING`
Job graph: исторические `CLAIMED`/`POLL_WAIT`/`STAGED` записи отменённых или
завершённых Jobs остаются audit evidence, но больше не уменьшают параллельное
окно. Для XMLStock `POLL_WAIT` вообще не занимает HTTP capacity; Redis permit
выдаётся выбранному credential/product непосредственно перед запросом.
Автоматический credential refresh не запускается во время активного manual
rank Job. Если уже начавшийся Job всё же пересёкся с более новой успешной
validation (например, при rolling upgrade), grant принимает только proof того
же credential, connector и `materialVersion`; смена routing/secret material
по-прежнему завершается как `ESTIMATE_STALE`. Этот инвариант повторён в
`assert_rank_connector_execution_scope`, а не оставлен только приложению.
Validation completion в PostgreSQL имеет микросекундную точность, а
JavaScript execution evidence — миллисекундную; migration
`20260805201500_rank_validation_timestamp_precision` сравнивает proof на
канонической миллисекундной границе. Это сохраняет строгую привязку к тому же
validation Job, но не отклоняет корректный XMLStock/Arsenkin grant из-за
скрытых микросекунд.
Project connector routes заменяются через retirement: использованные строки
сохраняются для execution history с `retiredAt`, а новые estimate/routing
queries видят только активную проекцию. Поэтому смена project override,
сокращение fallback и переход на workspace inheritance не нарушают FK
завершённых или выполняющихся provider executions.
Для rank route позиции `1..7` являются допустимыми явно выбранными
provider/credential маршрутами; grant, claim и submit проверяют exact route
из estimate, не подменяя его project default с позицией `0`.
После передачи проекта отключённый binding намеренно остаётся как
tenant-scoped audit/configuration row без активного маршрута: публичная
проекция возвращает `routes: []` и не возвращает `route`. Это состояние
означает «провайдер не настроен», а не сбой Jobs; интерфейс позволяет новому
владельцу явно выбрать credential его workspace, не восстанавливая прежний
provider route автоматически.

### Сбор частотности

Публичная command boundary принимает до 10 000 keywords и для Arsenkin, и для
XMLStock. Это platform safety bound, а не лимит XMLStock: Arsenkin отправляет
одну provider batch-задачу, XMLStock сохраняет тот же Job, но connector
выполняет по одному keyword на внешний `/wordstat/json/` request. Внутренние
resolve/persist chunks и per-credential `WORDSTAT` concurrency/RPS остаются
bounded, поэтому снятие прежнего UI/API-предела 200 не создаёт один гигантский
provider request и не связывает между собой разные BYOK-ключи.
Wizard по умолчанию выбирает регион «Россия» (`225`); в списке далее идут
Москва и Санкт-Петербург. `frontend/lib/seo-regions.generated.ts` хранит
проверенный snapshot полного российского subtree Яндекса (638 кодов) и всех
российских Google location ID текущего provider catalog (504 кода), а
`frontend/lib/seo-regions.ts` отдаёт отдельные provider-specific списки без
ложного сопоставления кодов между системами.

### Минус-слова, неявные дубли и карточка запроса

`Keyword.note` хранит ограниченную 4 000 символами проектную заметку; list
projection отдаёт только `hasNote`, а полный текст доступен через tenant-scoped
keyword insights. Те же insights объединяют `current_ranks` с последними 240
append-only `rank_snapshots`, поэтому график не создаёт отдельную историю и не
перезаписывает результаты съёма.

Пресеты минус-слов принадлежат Core SEO и хранят до 500 нормализованных слов.
Режимы совместимы с основным workflow Key Collector: быстрое и улучшенное
русскоязычное сопоставление словоформ, полное слово/фраза, подстрока и точное
совпадение всей фразы. Для стоп-фраз отдельно сохраняются флаги игнорирования
порядка слов и пунктуации; прежние пресеты после additive migration получают
оба значения `false` и не меняют поведение. Применение всегда двухфазное:
preview фиксирует scope/version/hash и отдаёт все совпадения страницами по 100
строк вместе с UTF-16 диапазонами для inline-подсветки. Web накапливает страницы
при прокрутке списка без селектора размера и ручных кнопок навигации. Затем команда
пакетами до 500 строк переносит совпадения в системную корзину, возвращает
точные удалённые keyword ID, создаёт reversible semantic version
`NEGATIVE_KEYWORDS` и повторно проверяет optimistic versions под project write
lock. Пресеты включены в allowlist передачи проекта.

Модуль `backend-core/modules/seo/src/semantic-duplicates` реализует
двухфазный поиск неявных дублей по order-independent мультимножеству слов:
точный либо улучшенный русскоязычный формонезависимый режим, опциональный
учёт регистра/пунктуации и до 100 слов-исключений. Scope ограничен всем
проектом, одной папкой или optimistic selection; синхронный анализ не
сканирует больше 50 000 активных строк. Preview отдаёт группы страницами по 100
с единым стабильным hash для всего анализа; Web накапливает их бесконечной
прокруткой, а каждая страница остаётся ограничена 500 кандидатами на удаление.
Каждая строка содержит полный запрос, все пути её папок и последние значения
частотностей `BASE`, `EXACT`, `FIXED` с теми же маркерами Яндекса, что и основная
таблица семантики. Умная отметка
оставляет фразу с максимальной базовой частотностью, приоритетом либо самой
ранней датой с детерминированными fallback, но Web позволяет пропустить группу
или явно выбрать другой keeper. Apply принимает только просмотренные решения,
повторно проверяет tenant, scope, версии удаляемых фраз и выбранных keepers под
project write lock; большой выбор Web применяет последовательными пакетами до
500 строк. Сервис не затрагивает непросмотренные/пропущенные группы, переносит
только проверенные варианты в системную корзину и создаёт reversible semantic version
`IMPLICIT_DUPLICATES`; постоянного удаления этот инструмент не выполняет.

### Импорт и crawl

Upload хранится в S3 и при включённой inspection role проходит ClamAV. Import
role стримит CSV/XLSX/KC4 в staging и публикует bounded idempotent chunks.
CSV и XLSX используют один табличный набор: полный путь папки хранится в одной
колонке группы, разбирается до 64 уровней и создаётся вместе со всеми
родительскими префиксами. Нулевое значение immutable semantic entitlement
означает отсутствие соответствующего тарифного лимита и разрешено DB guard.
Новый mapping по умолчанию работает в update-only режиме: метрики и другие
сопоставленные поля применяются только к существующим запросам, новые фразы
создаются лишь после явного включения `createMissingKeywords`. Validation
показывает число пропущенных новых фраз, а Core SEO повторно применяет тот же
guard внутри транзакции публикации. XLSX mapping распознаёт как канонические
названия, так и экспортные суффиксы Key Collector (`[Yandex]`, `[YW]`), включая
текущую/относительную позицию, URL позиции и базовую/фразовую частотность. При
обновлении существующего запроса Core
использует возвращённую Prisma запись с уже увеличенной `keyword.version`,
поэтому импортированная позиция привязывается к актуальной версии в immutable
rank manifest. Создаваемые для Key Collector import contexts остаются
техническими: они участвуют в keyword insights и графике импортированной
истории, но исключены из пользовательского каталога профилей live-съёма,
операций над tracking context и квоты отслеживаемых пар. Канонический BYOK
rank-history endpoint также не смешивает импорт с воспроизводимыми
провайдерскими замерами. Execution хранит `publishing_attempts` и после пяти
неудачных claims завершает импорт контролируемой terminal-ошибкой вместо
бесконечного цикла; уже принятые chunks остаются idempotent.
Crawl role выполняет SSRF/DNS-rebinding-safe обход с robots/sitemap policy,
checkpoint и lease; нормализованные snapshots принадлежат Core SEO.

Экспорт семантики всегда создаёт tenant-scoped `SEMANTIC_EXPORT` Job в
`jobs_db`: Core повторно проверяет `semantic.export`, фиксирует immutable
filter/sort/column/format snapshot и передаёт только Job ID в BullMQ-очередь
`exports`. Import-worker постранично читает Core SEO через отдельную read-only
границу `/internal/v1/projects/:projectId/semantic-exports/*`, защищённую
`JOBS_TO_SEO_DATA_TOKEN` и доверенным workspace/project/actor context, потоково
формирует CSV/TSV/JSON/NDJSON/XLSX
без материализации полного ядра в HTTP или памяти и multipart-записью сохраняет
артефакт в S3. XLSX автоматически делится по ограничению строк листа, а все
spreadsheet-форматы защищены от formula injection. Состояние и row progress
остаются PostgreSQL-owned; истёкший lease восстанавливается dispatcher-ом.
Скачивание выдаётся только после повторной browser permission-проверки в Core:
обычный пользовательский переход на `GET /api/v1/projects/:projectId/exports/:exportId/file`
получает поток с attachment disposition через Core и same-origin BFF. Core
одноразово получает короткоживущую signed URL у Execution и читает по ней
артефакт сервер-сервер, поэтому браузеру не раскрывается и не требуется
отдельный публичный S3-порт. Авторизация скачивания журналируется, а прямой
пользовательский клик не зависит от browser user-activation после async polling.
Drawer «Задачи и операции» продолжает polling после закрытия export modal,
показывает прогресс и позволяет остановить активный экспорт либо повторно скачать
завершённый файл прямой пользовательской ссылкой.

Проектный инструмент `/app/projects/{projectId}/tools/http-status-checker`
переиспользует тот же `technical-crawl` Job/queue/worker и отличается
зафиксированным `config.purpose=HTTP_STATUS_CHECK`. Поэтому новый deployable,
queue или таблица не добавлены. В UI он называется «Обход сайта»: принимает до
1 000 стартовых URL и обходит до 5 000 страниц только домена проекта, sitemap
и внутренние ссылки со скоростью не
более 60 запросов в минуту на host, сохраняет status/redirect chain по мере
обхода и не создаёт SEO issues, duplicate analysis или Radar page changes.
Опциональные `homepageChecks` сервером разворачиваются в bounded probes для
HTTP, альтернативного `www` и путей с `//`…`/////`; они входят в `maxUrls`,
checkpoint и operation result, но не расширяют discovery за origin проекта.
Result boundary принимает сохранённую 1-based нумерацию страниц `1…5000`,
совпадающую с persist contract и максимальным crawl limit; граничная пятитысячная
строка не делает валидный завершённый результат недоступным.
`TECHNICAL_AUDIT` остаётся backward-compatible purpose для старых записей и
automation. Оба режима читаются через tenant-scoped operation result, но в UI
и terminal notification имеют разные названия и ссылки на конкретный crawl.
Каждая строка сохраняет bounded meta tags, Title/Description/H1, canonical,
robots, structured data, image/alt/word metrics, response time и размер.
`savePageMap=true` автоматически поднимает эту snapshot-проекцию в карту
страниц; `false` сохраняет immutable operation result и скрытую FK backing Page,
но не меняет видимую карту. Page Map показывает дерево до 5 000 URL и компактный
последний snapshot в таблице, а полный meta-tag payload получает только при
открытии tenant-scoped инспектора. Core bridge принимает старую и актуальную
форму crawl config, включая optional `savePageMap`, без ослабления exact-field
валидации. Page Map и Markdown Notes работают как full-height workspace:
основные колонки не имеют внешних карточных зазоров и прокручиваются независимо.
Page Map передаёт выбор дерева отдельным `pathPrefix`, показывает конкретные
tenant-scoped crawl issue evidence по проверенному `pageId` в инспекторе,
держит table header сверху и локально запоминает изменяемую ширину дерева,
инспектора и колонок. Папки структуры раскрываются и сворачиваются независимо;
явные состояния раскрытия ограниченно сохраняются в project-scoped browser
layout, а глубокие ветки не создают большой DOM до открытия. Notes не
растягивает одну карточку на всю высоту списка и не дублирует page heading.

### Notifications

Core пишет redacted outbox events. JetStream consumers проверяют точные
stream/subject/durable параметры. Auth-email получает JIT material через
отдельный internal boundary; Web Push device material остаётся в Realtime.
Terminal Job reconciler работает внутри HTTP-role Execution и получает
`PLATFORM_API_URL`/bounded command timeout через supervisor allowlist; поэтому
завершение, частичный результат, отмена, окончательная ошибка и
`ACTION_REQUIRED` каждого project Job доставляются в Core, а затем в единый
центр уведомлений без обращения Execution к Core DB. Realtime принимает два
точных resource-контракта: `technical_crawl` и tenant-bound `job`, причём Job
ID обязан совпадать с deep link и dedupe key. Миграции
`20260805163000_retry_terminal_job_notifications` и
`20260805171000_retry_terminal_notifications_after_contract_fix` ограниченно
возвращают в очередь idempotent terminal events, исчерпавшие retry до
исправления route/resource allowlist. Пользовательские Job-заголовки используют
грамматически нейтральный формат `Операция: статус`; ограниченная Realtime
миграция исправляет только прежние системные шаблоны.

### Platform admin: ручная подписка

Admin BFF пропускает только явно перечисленные workspace и billing paths.
Core проверяет platform role независимо от tenant membership; чтение доступно
операционным/support/finance ролям, изменение подписки — только `FINANCE` или
`SUPER_ADMIN`. Запись `billing_subscriptions`, redacted `audit_events` и
`platform_admin_command_receipts` создаются или изменяются в одной транзакции.
Последняя таблица хранит hash запроса и response snapshot: повтор с тем же
ключом безопасно возвращает исходный результат, а другой payload завершается
`IDEMPOTENCY_CONFLICT`. `If-Match`/`If-None-Match` предотвращает потерю
параллельного изменения. UI не является универсальным редактором БД и не
позволяет менять ledger history.

### Platform admin: проекты и операции

Admin BFF отдельно allowlist-ит только collection routes `projects` и
`operations`; вложенные произвольные команды через эти roots запрещены.
Каталог проектов ограничен 50 строками и ищет по project/workspace identity и
автору. SEO Data endpoint принимает не более 50 уникальных UUID и считает
только active/non-deleted keywords и active folders без `system_kind`.
Execution endpoint отдаёт не более 100 Jobs на страницу по immutable cursor,
а totals разделяет на active, completed и attention. Эти экраны являются
read-only и не обходят существующие service/database ownership boundaries.

Первый `SUPER_ADMIN` назначается production bootstrap-entrypoint
`/app/dist/platform-admin-bootstrap.js`: корневой runtime делегирует команду
модулю `@seo-platform/backend-core-api/platform-admin-bootstrap`, использует
контейнерный `PLATFORM_DATABASE_URL`, не зависит от dev-only пакетов и допускает
безопасный повтор только для уже активного назначения тому же аккаунту. После
bootstrap оператор заново входит с MFA, чтобы session authentication была
новее подтверждения MFA.

### Передача проекта

Core хранит владельца проекта и `project_transfer_requests`. Текущий владелец
создаёт один pending-запрос для активного участника workspace; адресат видит
его в том же account-scoped центре, что и workspace invitation, и явно
принимает либо отклоняет. При принятии адресат выбирает другую свою активную
workspace с `project.create` и свободной project capacity.

Перенос следует ADR-2026-042 и идёт возобновляемой saga: Core переводит проект
в read-only `ARCHIVED`; Execution проверяет отсутствие активных Jobs/imports,
останавливает automations, отключает project bindings и retire-ит provider
routes; Core SEO параметризованной maintenance-функцией атомарно меняет tenant
scope явно перечисленных проектных domain rows; immutable rank/crawl storage
разрешает только точный tenant re-key из этой `SECURITY DEFINER`-функции, а
rank manifest сохраняет исходный `integrity_workspace_id` для проверки hash;
только затем Core меняет `workspace_id`, владельца и project access.
Guard-предикат immutable re-key доступен `seo_runtime` только для вызова из
обычных trigger `WHEN`, но возвращает `false` для runtime invoker: разрешение
re-key возможно исключительно внутри owner-owned `SECURITY DEFINER` transfer
routine. Это сохраняет обычные rank manifest update/finalization после
передачи и не расширяет права runtime.
Credential rows, provider/billing history, uploads и import
staging остаются у исходной workspace. Новый владелец настраивает project
bindings заново и может использовать только credentials целевой workspace.
`PENDING` истекает через 7 дней и допускает отмену/отказ; `PROCESSING`
повторяется reconciler-ом с bounded backoff и защищён вместе с pending partial
unique index. Право `project.transfer` следует за новым `owner_user_id`.

### Удаление проекта

Core API выполняет owner-only soft delete с автоматически проверяемой active
session, CSRF, exact-name confirmation и `If-Match`, без интерактивного
повторного логина. Активная передача блокирует команду. В одной
транзакции проект получает `DELETED`/`deletedAt`, append-only audit и redacted
`project.deleted.v1`; физические tenant-owned SEO/Execution данные не
удаляются, поэтому операция не создаёт риск потери данных или частичной
межбазовой очистки.

### Проектные заметки

Core SEO владеет versioned Markdown-заметками. Защищённые CRUD routes проходят
через Core API и проверенный workspace/project context; Markdown рендерится без
raw HTML. Видимость `PROJECT_MEMBERS` оставляет заметку внутри проекта, а
`PUBLIC` создаёт opaque random token и public `no-store`/`noindex` route.
Возврат к закрытой видимости или удаление атомарно отзывает публичный token.

## 7. Конфигурация и эксплуатация

- Node.js 24+, pnpm 11, TypeScript strict.
- `.env.example` содержит только имена и безопасные placeholders.
- Redis разделён на durable Jobs (`AOF`, `noeviction`) и ephemeral Realtime
  Pub/Sub; named users ограничены versioned key/channel namespaces.
- Все application processes работают в UTC.
- Production template включает S3 и inspection. S3 objects физически
  изолируются неизменяемым `S3_KEY_PREFIX`, при этом в Jobs DB хранится
  логический object key. Inspection, Web Push, YooKassa и provider paths могут
  быть явно выключены; недоступная функция не имитирует успех.
- Инструкция развёртывания: `infrastructure/DOKPLOY.md`.
- Secrets, application S3 и четыре PostgreSQL backup job:
  `infrastructure/DOKPLOY-SECRETS.md`.
- Local production-like runtime: `infrastructure/vps/README.md`.

## 8. Проверка

```bash
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm infra:validate` дополнительно проверяет Compose там, где установлен
Docker Compose. Изменение Prisma migrations требует ручного review SQL и
проверки на PostgreSQL 18.

## 9. Актуальные ограничения

- Физическое объединение трёх Core compatibility databases в schema-based
  `app_db` не выполнено и требует отдельного replayable cutover.
- Production release требует operator-owned SMTP, provider/YooKassa canaries,
  alerting и проверенных backup/restore drills.
- Dokploy database backups являются logical dump; PostgreSQL PITR/WAL остаётся
  отдельным production hardening шагом при более строгом RPO.
- Если измерения потребуют независимого масштабирования отдельной child role,
  тот же artifact можно снова запустить отдельным process profile без возврата
  старых исходных каталогов.

Карту обновляют при изменении deployable, process role, data ownership,
очереди/события, базы, обязательной конфигурации или startup topology.
