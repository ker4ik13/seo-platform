# Карта проекта

Последнее обновление: 1 августа 2026 года

Текущий инкремент: проверенный single-node VPS runtime и закрытие оставшихся
пользовательских P1/P2-контуров по ТЗ. На VPS без Docker/sudo собран
persistent runtime в `platform-infrastructure/vps`: PostgreSQL 18, два
изолированных Redis, NATS JetStream, versioned MinIO, ClamAV, четыре HTTP
сервиса, Web и выделенные system/import/inspection/rank/crawl/connector
workers работают в detached `tmux`-сессии. Все data/application listeners
остаются на loopback; системный Caddy публикует Web и отдельный TLS endpoint
MinIO без раскрытия console/admin API. Секреты генерируются вне Git в
mode-600 `runtime.env`, процессы запускаются с очищенным окружением.
Runbook: `platform-infrastructure/vps/README.md`.

Живой smoke на этом runtime подтверждает:
`register → workspace/trial/project/team → real HTTP crawl → multipart upload
через публичный signed URL → CORS → ClamAV inspection → semantic
mapping/validation/publish → keyword read model`. Исправлены фактический
HTTP-request lifecycle crawler, DNS/IP pinning и JSONB-order regression в
SHA-256 semantic publication envelope. Полный repository lint/typecheck/test
на этом состоянии проходит. Отдельный live XLSX smoke подтверждает первый
видимый лист, shared strings и cached formula result во всём том же
upload/inspection/import/publish контуре. Production dependency audit после
точечных lockfile overrides: 0 известных low/moderate/high/critical
advisories. Внешние коммерческие gates остаются честно
выключены до выдачи владельцем YooKassa, SMTP и реальных provider BYOK
credentials; это не блокирует продолжение остальных продуктовых контуров.
Отдельный live sitemap smoke прошёл на RFC Editor: sitemap index с двумя
дочерними документами, include scope `/about/**`, checkpoint v2 и три
страницы; PostgreSQL snapshot evidence подтвердил один explicit seed с
`inSitemap=false` и две sitemap-страницы с `inSitemap=true`.
После применения conditional/backoff migrations повторный живой crawl
`https://example.com/` завершился через публичный runtime; SEO Data evidence
подтвердил новый snapshot с `notModified=true` и tenant-bound
`reusedFromSnapshotId`. Полный повторный smoke одновременно подтвердил
регистрацию, trial, проект, crawl, MinIO/CORS/ClamAV и публикацию XLSX
семантики. После добавления Radar schedules ещё один полный live smoke
подтвердил создание daily/weekly crawl automation, отдельный авторизованный
manual dispatch, завершение связанного технического crawl, terminal run
settlement и ручную паузу; тот же сценарий повторно прошёл регистрацию,
workspace/trial/project, team/billing read projections, обычный crawl и
полный XLSX upload/inspection/import/publish контур.
После добавления duplicate-group анализа live crawl двух разных URL с
одинаковым HTML создал группы `CONTENT/TITLE/H1`, а следующий automation
обход успешно повторно использовал оба snapshot по `304`. VPS и Dokploy
Compose теперь принудительно запускают PostgreSQL и все Node runtimes в UTC;
automation claims фиксируют `createdAt` тем же database clock, что
`startedAt/finishedAt`, поэтому chronology constraints не зависят от
часового пояса хоста и задержки между чтением clock и `INSERT`.
После добавления crawl membership analysis полный public smoke
`019fb7f6-14a6-73c9-b434-1171c8e25128` подтвердил новый tenant endpoint
исчезнувших страниц вместе с обычным/automation crawl и полным XLSX import.
В живой БД оба complete run сохранили разные scope fingerprints и ноль
ложных absences; same-scope disappearance/reappearance отдельно проверены на
чистой PostgreSQL 18.
После добавления terminal crawl notifications полный public smoke
`019fb80c-5da3-7618-99e3-dfc6578e4c13` подтвердил durable
`outbox_events → Jobs dispatcher → fresh Platform authorization → Realtime`
доставку персонального `CRAWL_RADAR` уведомления без дублирования.

Production technical crawl и audit issues работают поверх Page Map, реального
съёма позиций и тарифных capacity boundaries.
Статус P1: ручной CRUD запросов, иерархических групп и manual-кластеров реализован поверх
tenant-scoped SEO Data owner с optimistic locking, RBAC/CSRF и audit.
Запрос уже можно создать, изменить и soft-delete; поддерживаются текст,
BCP-47 язык, приоритет, избранное, intent, группа, кластер, target URL и теги.
Группы имеют вложенность, защищённый перенос без циклов, CAS и запрет удаления
непустой группы. Кластеры имеют tenant-scoped CRUD, CAS, case-insensitive
защиту от дублей и запрет удаления, пока им назначены активные запросы;
общая advisory-lock граница не допускает гонку удаления и назначения. Для
кластера можно выбрать ровно одну активную primary Page и сохранить источник,
confidence и rationale назначения. Read model вычисляет запросы без URL и
отличающиеся target pages как missing-landing/cannibalization diagnostics;
назначенную primary Page нельзя архивировать до переноса кластеров.
Ручной кластер можно зафиксировать и исключить из будущей автоматической
рекластеризации. Выбор 2–50 кластеров поддерживает отдельный merge preview:
показывает число переносимых запросов, конфликтующие посадочные, locked и
устаревшие сущности. Apply под единым keyword/cluster lock атомарно переносит
до 450 запросов в выбранный кластер-получатель, soft-delete-ит исходные
кластеры и создаёт один смешанный reversible change set. Более крупный scope
честно возвращает `BACKGROUND_OPERATION_REQUIRED`, пока asynchronous merge
не реализован.
Выбранные запросы одного кластера можно выделить в новый кластер через
компактный split workflow внутри массового редактора. Preview проверяет CAS
исходного кластера и каждого запроса, занятое имя, принадлежность и запрет
оставлять исходный кластер пустым. Apply под теми же keyword/cluster locks
атомарно создаёт новый manual-кластер, переносит до 450 запросов и сохраняет
единый mixed reversible change set; dependency-aware undo сначала учитывает
возврат запросов и только затем допускает удаление созданного кластера.
Platform API валидирует публичный ввод и никогда не принимает
workspace/actor из browser body; Web использует same-origin BFF и показывает
конфликты версии без silent overwrite. Bounded bulk-команда принимает 1–200
явных keyword ID с отдельной ожидаемой версией, возвращает changed/skipped/
failed/conflicted partition и позволяет массово менять приоритет, избранное,
intent, группу, кластер, target URL и теги без blind overwrite. Для выбранных
1–200 запросов доступен bounded cleaner: пользователь явно
выбирает пробелы, кавычки, дефисы, `ё/е`, регистр и удаление поисковых
операторов, получает row-level preview с duplicate/CAS/invalid состояниями и
только затем применяет допустимые строки. Apply создаёт одну reversible
semantic version `CLEANING`, поэтому результат доступен в истории и undo.
Серверный keyword read model поддерживает allowlisted
intent/group/cluster/favorite/tracked/priority
filters и пять стабильных keyset sorts; cursor криптографически связан с
фильтрами и сортировкой через SHA-256 fingerprint. Private и project-shared saved views сохраняют
строго валидируемый versioned DSL (фильтры, сортировка, видимость/порядок
колонок и плотность), имеют owner boundary, CAS, soft delete и browser UI.
Web workspace семантики следует проверенным паттернам Key Collector:
постоянное дерево групп, плотная таблица, быстрый поиск/фильтры и массовые
операции находятся на основном экране без промежуточного отступа от общего
sidebar. Ручное добавление принимает в textarea до 2 000 запросов по одному
в строке, нормализует пробелы, пропускает дубли и при частичной ошибке
оставляет для повтора только необработанные строки. Группы поддерживают
collapse, multi-select, right-click menu и
drag-and-drop перенос с server-side CAS; строки имеют row context menu, bulk
bar, drag-and-drop в дерево и правый inspector. Таблица использует
cursor-based infinite scroll с оконным DOM-render и догружает следующий
cursor только у нижней границы scroll-контейнера, а не постраничной
навигацией. Импорт, управление группами/колонками, кластерами и
история открываются в native modal/dialog layers и не вытесняют ядро. Импорт начинает
с компактного выбора CSV/TSV/XLSX, а mapping, preview, validation и публикация
раскрываются только по мере прохождения этапов. Из того же toolbar доступен рабочий Keys.so-сценарий сбора запросов
конкурентов с preview и явным подтверждением импорта в текущее ядро.
Сбор частотности запускается из семантики как durable XMLStock Wordstat Job,
показывает прогресс/историю/повтор/отмену в правом журнале и до запуска
проверяет project binding. Проверка позиций назначает выбранные запросы
контексту, получает estimate и создаёт Arsenkin Job; если контекстов ещё нет,
modal создаёт первый совместимый Google Top-30 контекст inline и продолжает
тот же запуск без перехода на отдельную страницу.
Custom columns базовых типов реализованы отдельными tenant-scoped definitions
и typed EAV values: text/long text/integer/decimal/boolean/date/datetime/
select/multi-select/URL/user/status. Каждая ячейка имеет CAS; PostgreSQL
constraint и trigger обеспечивают ровно одно значение правильного типа,
tenant-prefixed btree/GIN indexes делают значения фильтруемыми без JSON-only
storage. Web создаёт/настраивает колонки и редактирует ячейки; import mapping
создаёт LONG_TEXT definitions и typed values, а migration backfill-ит legacy
JSON только при доказуемой actor provenance.
Bounded semantic export доступен из таблицы и публичного project API:
выбранные строки, текущий фильтр, поддерево группы и полное ядро до 2 000
строк выгружаются с текущей сортировкой и видимыми/custom колонками в
CSV/TSV/JSON/NDJSON или Google Sheets-safe CSV. Download проходит через
same-origin streaming BFF, требует `semantic.export` и CSRF, сохраняет audit,
не раскрывает tenant context из browser body и защищает Google CSV от formula
injection. Табличные заголовки локализуются, CSV имеет RFC-совместимое
экранирование, JSON сохраняет typed custom values. Следующий P1 slice:
асинхронные большие XLSX/archive exports с S3 signed URL.
История semantic versions теперь получает tenant-safe append-only change set
для ручного create/update/delete запросов и кластеров, bounded keyword bulk
update, cluster merge и пакетного назначения cluster primary Page. Before/after state
записывается в той же PostgreSQL-транзакции, bulk version остаётся
необратимой до финализации, а общий advisory lock сериализует ручные правки,
import chunks и undo. Web показывает последние версии и сначала запрашивает
preview; undo применяет только строки с exact current version и доступными
cluster/group/page/tag dependencies, включая primary Page кластера, не
перезаписывает более новые изменения,
сообщает конфликты и сам создаёт новую откатываемую версию. Undo требует
stable `Idempotency-Key`; tenant/project/actor-scoped receipt сохраняет
исходный результат в той же транзакции, поэтому повтор после неоднозначного
сетевого ответа не применяет откат второй раз, а повторное использование
ключа для другой версии даёт `409`. Импорты
появляются в истории с parent/source/affected metadata, но остаются
history-only до сохранения полного масштабируемого row change package.
Синхронный undo ограничен 500 изменениями. Следом в P1: version packages для
custom cells/groups/import, asynchronous undo/export и collaboration.

P2 runtime: versioned tracking context, provider-free оценка и immutable
execution manifest в SEO Data завершены. Estimate хранится в `jobs_db`,
доступен при read-only и не вызывает provider, decrypt, Job/BullMQ, списание
или event. SEO Data атомарно seal-ит bounded keyword snapshots в immutable
header/chunks/entries и защищает active semantic dedup. Jobs durable создаёт
`PREPARING` Job и immutable sidecar, seal-ит manifest через изолированный
rank-worker, восстанавливает потерянные BullMQ notifications, сериализует
cancel и закрывает sealed cancellation через SEO Data finalize. Неоднозначный
исход ограниченно повторяется exact-командой и затем становится
`ACTION_REQUIRED`, а не ложным `NOT_SEALED`. Public Platform API и
восстанавливаемый Web Job flow готовы. SEO Data принимает exact normalized
chunks, атомарно строит append-only snapshots/current projection, завершает
успешный/partial manifest с redacted outbox event и предоставляет internal
keyset history. Platform API публикует bounded read-only history proxy, а Web
— private/noindex экран с фильтрами и cursor-дозагрузкой.

Platform API имеет protected issuer одноразового 30-секундного execution
grant: он повторно проверяет owned lifecycle/RBAC state под row locks и
сохраняет immutable exact decision receipt. Jobs добавил bounded issuer
client и durable intent/consume: exact `REQUESTED` записывается до HTTP,
retryable ambiguity повторяет тот же request/idempotency key, а решение
сохраняется как `DENIED`, `EXPIRED`, `GRANTED_PENDING_CONSUME` либо
`REJECTED_LOCAL`. Неистёкшее положительное решение под тем же canonical lock
order атомарно переходит в `CONSUMED` вместе с единственным secret-free
`rank_connector_executions/READY_TO_SUBMIT`. Строка связывает exact
Job/item/grant/manifest/binding/route/credential-version evidence, но не
содержит credential material. Перед grant Jobs дважды проверяет locked
Job/Run/Item graph вокруг bounded чтения sealed manifest chunk, сохраняет
единственный append-only privacy-sensitive, но secret-free
`rank_provider_request_intents` snapshot и связывает его ID, request hash и
chunk hash с private execution evidence и connector execution FK.

Controlled-beta policy выдаёт grant только для exact
`manual-arsenkin-positions@1.0.0`, резервирует одну immutable
`RANK_PROVIDER_TASK` на JobItem/attempt и ограничивает workspace 200 provider
tasks на календарные UTC-сутки. Receipt связан с reservation составным
tenant/job/item FK. Rank dispatcher восстанавливает готовые sealed Jobs из
PostgreSQL, переводит `QUEUED → RUNNING`, выдаёт все chunk grants со stable
idempotency identity и финализирует доказанный отказ через SEO Data как
`FAILED/EXECUTION_GRANT_DENIED`; неоднозначный transport outcome остаётся
retryable. Default-closed SECURITY DEFINER claim DDL переводит eligible row
в bounded pre-network `CLAIMED` и возвращает только одну exact encrypted
credential projection после full current-graph recheck. Exact deploy-time
connector permissions выдают только broker/claim/authorize signatures без
table DML. Submit authorization повторно блокирует полный current graph,
сверяет owner/token/lease generation/row version и атомарно фиксирует
`SUBMITTING` с durable marker до возможных network bytes.

Реальный Arsenkin runtime замкнут: connector-worker отправляет документированный
`check-top` POST, соблюдает общий лимит 30 запросов/минуту и не более пяти
одновременных provider tasks, durable сохраняет wire snapshot/hash и task ID,
poll-ит результат, но никогда не хранит raw provider body. Нормализованный
found/not-found chunk проходит через отдельный SEO Data result boundary,
после чего rank-worker атомарно закрывает Job/JobItems/manifest как
`COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED` или `ACTION_REQUIRED`.
Поддержанный первый production profile ограничен Google, глубиной 30,
числовым Arsenkin region ID, выключенным safe search и однозначными URL rules;
несовместимая конфигурация блокируется ещё на estimate, до provider call.
Устаревшие unconditional beta-blockers с estimate-path удалены: Platform API
теперь получает BYOK entitlement из действующего тарифа, а executable estimate
становится `READY` только при полном совпадении этого production profile,
активном binding и свежей validation. Неизвестный/неподдержанный mapping
остаётся fail-closed с точным blocker code.
Миграция activation переводит DB-control на новую kill-switch generation
`arsenkin-positions@2`; Compose включает submit только в isolated
connector-worker. Старые execution evidence поколения `@1` активироваться
задним числом не могут.

Rank-tracking automation теперь является рабочим сквозным модулем. Public
Platform API и private Web позволяют создать и изменить daily/weekly
расписание в IANA timezone, приостановить/возобновить его, запустить вручную
и прочитать последние 50 запусков. Platform API каждый раз получает
актуальные tenant/membership/project/BYOK/plan snapshots, проверяет отдельные
`automation.view/manage/enable`, CSRF, `If-Match` и `Idempotency-Key`, пишет
requested/committed audit. Jobs хранит versioned definition и immutable
per-run execution snapshot, атомарно ограничивает число включённых
расписаний по `scheduledAutomations`, синхронизирует BullMQ Job Scheduler,
не допускает overlap одного расписания и запускает существующий
estimate → manual rank Job pipeline. Terminal Job сбрасывает счётчик ошибок;
повторные ошибки выключают расписание на настроенном пороге. Bounded
reconciliation восстанавливает потерянный scheduler, зависший pre-dispatch
run и terminal outcome после restart. Queue payload не содержит keyword,
credential или secret material.

Page Map теперь является рабочим сквозным модулем. SEO Data остаётся
единственным владельцем страниц и хранит canonical URL, нормализованную
identity, до 100 алиасов, источники, тип, индексируемость, HTTP/canonical/
robots, Title/Description/H1, язык, шаблон, content workflow, владельца,
приоритет, даты, метрики, заметки и lifecycle с optimistic locking.
Назначения `Keyword.targetPageId` защищены составным tenant/project FK, а
canonical и alias identities сериализуются общей PostgreSQL advisory-lock
границей и не могут принадлежать двум страницам. Ручные назначения и
semantic import используют один URL normalizer и сохраняют `MANUAL`/`IMPORT`
provenance. Public Platform API предоставляет bounded keyset list, detail,
идемпотентное create, CAS update, archive/restore, проверяет
`page.view/page.manage`, CSRF и immutable tenant context, пишет requested и
committed audit и строго валидирует owner-response. Private/noindex Web route
`/app/projects/:projectId/pages` включён в навигацию: доступны поиск и
фильтры, создание/редактирование, алиасы и SEO-метаданные, архив,
восстановление, loading/empty/error/offline/read-only states и фактическое
число назначенных запросов. Fresh migration-chain и DB smoke подтверждают
tenant FK и конфликт canonical/alias.

Первый production technical crawl vertical замкнут сквозным образом.
Platform API создаёт идемпотентный асинхронный Job, проверяет
`page.view/page.manage`, CSRF, mutable tenant context, optimistic cancel и
audit. Выделенный `crawl-worker` соблюдает обязательный `robots.txt`,
идентифицируемый User-Agent, rate/depth/URL/timeout/size/redirect budgets и
запрещает private/link-local/metadata/reserved IP как после DNS resolution,
так и на фактическом socket. Один host имеет не более одного активного
crawl. PostgreSQL остаётся источником истины: lease, bounded durable
`pending/seen` checkpoint и dispatcher восстанавливают crash/потерянную
BullMQ-постановку; идемпотентный SEO Data receipt не задваивает счётчики при
сбое между snapshot и Job checkpoint. SEO Data не хранит raw HTML, а
сохраняет immutable page snapshots/issue occurrences и current open/resolved
issue projection. Page Map обновляется из `CRAWL` provenance. Web позволяет
запустить/остановить обход, показывает polling progress, историю и открытые
проблемы с loading/empty/error/read-only states.
В Web сама Page Map показана первой: история запусков, открытые проблемы и
duplicate/absence/change evidence складываются в компактные раскрывающиеся
секции со счётчиками; активный обход раскрывается автоматически. Конфигурация
ручного обхода и автоматический Radar доступны по запросу и не занимают
основной рабочий экран.

Radar теперь автоматически сравнивает повторный crawl одной Page: к каждому
значимому отличию создаётся отдельный immutable `crawl_page_changes` с
tenant-safe ссылками на предыдущий/текущий snapshot, crawl Job, severity,
before/after/diff SHA-256 и bounded нормализованным diff без raw HTML.
Сравнение покрывает HTTP status/redirect chain, метаданные, canonical/robots,
headings/hreflang/schema, ссылки, content hash, indexability, изображения и
пороговые изменения latency/размера. Internal SEO Data и public Platform API
возвращают максимум 500 строго валидируемых изменений под `page.view`, а Web
показывает русскоязычную историю между обходами и корректный empty state.

После финализации каждого complete/partial crawl SEO Data один раз под
advisory lock анализирует успешные HTML snapshots и сохраняет immutable
группы дублирующегося content hash, нормализованных Title, Description и H1.
Группы и их полный bounded member list связаны составными tenant/project/crawl
FK; для каждой группы создаётся current issue соответствующей severity.
Public API отдаёт их только под `page.view`, Web поддерживает фильтр по типу,
пагинацию и раскрытие URL, а повторная финализация остаётся идемпотентной.

Каждый terminal crawl также сохраняет immutable membership analysis с
SHA-256 scope fingerprint. Только два полных обхода с теми же start/sitemap
URL, include/exclude/query/robots/depth/limit настройками сравниваются между
собой; partial/cancelled run и изменённый scope не могут создать ложную
пропажу. Страницы, отсутствующие в новом полном обходе, сохраняются как
tenant-bound immutable evidence и current issue
`URL_DISAPPEARED_FROM_CRAWL`; повторное появление URL закрывает issue.
Platform API и Web под `page.view` показывают последний seen snapshot,
sitemap provenance и время обнаружения.

Настройки technical crawl теперь поддерживают до десяти same-origin sitemap,
include/exclude glob-маски и явную политику query-параметров. Crawl worker
безопасно читает bounded XML и `.xml.gz`, обходит до двадцати same-origin
документов sitemap index, применяет единый host rate limit к robots, sitemap
и HTML-запросам, включая каждый redirect hop, и сохраняет crash-safe sitemap
traversal в checkpoint v2.
Каждый immutable page snapshot содержит `inSitemap`; Page Map получает
`SITEMAP` provenance, а Radar показывает изменение sitemap membership для
страниц, присутствующих в обоих обходах. Старые crawl config/checkpoint без
sitemap автоматически читаются с безопасными defaults; additive Jobs
migration сохраняет DB-совместимость checkpoint v1 и bounded checkpoint v2.

Radar conditional request path теперь хранит bounded `ETag`/`Last-Modified`
в SEO Data snapshot и передаёт crawler только точный validator последнего
снимка. Ответ `304` создаёт новый immutable snapshot с
`reusedFromSnapshotId`, переносит прежние issue evidence и cached internal
links для продолжения обхода, но не создаёт ложный content diff; изменение
`inSitemap` при этом остаётся видимым.
Jobs владеет глобальным `crawl_host_states`: `429`, `503`, DNS/timeout/network
ошибки, `Retry-After` и измеренный рост latency включают bounded exponential
backoff для host сразу между всеми workspace. Crawl сохраняет checkpoint,
переходит обратно в durable queue с `backoffCode/backoffUntil`, не расходует
page attempt и автоматически возобновляется dispatcher-ом; Web показывает
причину и время следующей попытки. После шести последовательных сигналов
сайт автоматически получает отдельный `SITE_PAUSED` cooldown на 24 часа;
успешный ответ под тем же global host lock сбрасывает failure series.
Каждый ручной crawl теперь также хранит bounded `maxRuntimeSeconds`
(1–360 минут, безопасный default для legacy config). Deadline включает
pacing и повторные доставки: worker до следующего сетевого запроса завершает
просроченный обход как `PARTIALLY_COMPLETED` с
`MAX_RUNTIME_EXCEEDED`, сохраняя уже собранные snapshots.

Radar schedules теперь замкнуты отдельным production-контуром. Public API и
Web на экране аудита создают daily/weekly расписание в IANA timezone с
разрешённым локальным окном, crawl config, OCC, CSRF, idempotency и
`automation.view/manage/enable`/`page.manage`. Jobs владеет versioned
`crawl_automations` и immutable `crawl_automation_runs`, отдельным BullMQ Job
Scheduler и общим plan-capacity lock с rank automations. До dispatch
отсекаются quiet window, overlap, активный crawl того же host и глобальный
host backoff. Каждый фактический запуск идёт через dedicated
`JOBS_TO_PLATFORM_AUTOMATION_TOKEN`: Platform API заново проверяет текущие
membership/RBAC/workspace/project границы и только затем идемпотентно создаёт
technical crawl. В том же pre-dispatch gate заново проверяется текущий
billing entitlement, поэтому истёкшая после создания расписания подписка не
может запустить платный crawl; manual run использует ту же fresh billing
границу. Reconciliation восстанавливает scheduler/pre-dispatch и settle-ит
terminal crawl; ошибки включают threshold auto-pause, а отозванная
авторизация/read-only billing выключают расписание сразу. Jobs API Redis ACL
включает точный `crawl-automation` keyspace, а readiness выполняет bounded
операцию в каждом из восьми queue keyspaces вместо недостаточного `PING`.

P3 billing foundation реализован в Platform API и Web. Versioned каталог
содержит Trial/Solo/Team/Agency/Business/Enterprise и годовые цены; hosted
checkout YooKassa не принимает карточные данные, использует provider
idempotence, canonical GET после webhook, официальный source-IP allowlist и
bounded reconciliation. Поддержаны trial, подписка, пополнение data balance,
сохранённый способ с отдельным согласием, автопродление, отключение продления,
полный/частичный refund только в пределах неиспользованного остатка, payment
history и manual-NPD receipt obligations. PII плательщика шифруется
AES-256-GCM с purpose-bound AAD; секрет YooKassa получает только Platform API.
Double-entry ledger защищён PostgreSQL triggers: только balanced DRAFT→POSTED,
append-only update/delete и запрет TRUNCATE. Included credits не переносятся
на новый период; failed renewal проходит past_due/grace и переводит workspace
в read-only, успешная оплата восстанавливает доступ. Реальный provider
checkout/автоплатёж остаётся operator gate до выдачи shop ID/secret, настройки
webhook и sandbox/live canary. Защищённая operations-панель уже закрывает
ручную регистрацию, cancellation после полного refund и replacement после
частичного refund чека «Мой налог». Регистрация обычного или replacement
чека атомарно создаёт secret-free событие; transactional-email worker
получает recipient и официальный URL JIT, отправляет локализованный чек и
идемпотентно фиксирует `DELIVERED` либо terminal bounce.
Plan entitlement больше не является UI-only: общий
`BillingEntitlementService` строго разбирает immutable feature snapshot,
использует DB clock и сериализует capacity-команды блокировкой workspace.
Создание проекта считает все сохранённые slots; invitation резервирует seat,
а acceptance повторно проверяет active/suspended members. `CLIENT` закрыт
до тарифа с `clientRole`. При отсутствии подписки onboarding ограничен
Trial-каталогом, но истёкшая/заблокированная подписка не откатывается на
бесплатный fallback. Controlled-beta Arsenkin grant теперь проверяет
действующий BYOK entitlement до quota reservation. Актуальный semantic
capacity snapshot теперь передаётся только по доверенной Platform API
границе: SEO Data атомарно ограничивает workspace/project active keywords,
undo-восстановления и active tracking-context pairs. Manual write, undo и
import используют единый порядок advisory locks. Import confirmation
фиксирует plan/version/limits в Jobs DB, а SEO receipt резервирует ожидаемые
новые keywords; каждый chunk превращает резерв в фактические строки,
complete/partial complete освобождает остаток, cancel/final failure переводит
пустой receipt в `ABORTED`. Поэтому параллельные ручные команды, несколько
проектов и массовый импорт не обходят `storedKeywords`,
`keywordsPerProject` или `trackedContextPairs`. Storage capacity также
переведён с UI-only ограничения на trusted internal snapshot: Platform API
получает актуальный `storageBytes` только из действующего immutable plan,
а Jobs под workspace advisory lock атомарно считает все `INITIATED`,
`UPLOADING`, `UPLOADED`, `SCANNING` и `READY` uploads до создания новой
multipart-записи. Параллельные загрузки не обходят тариф, идемпотентный
проигравший multipart удаляется, а существующие файлы при превышении не
удаляются. Automation capacity enforcement замкнут отдельным trusted snapshot
и workspace advisory lock; platform-paid settlement остаётся следующей частью
enforcement.

Browser Web Push lifecycle и delivery реализованы по ADR-2026-035/039:
профиль владеет устройствами, Platform API управляет ими через отдельный
Realtime token, secret material хранится в `realtime_db` под AES-256-GCM и
отдельными HMAC fingerprints, а Web регистрирует Service Worker только для
`/app/`. Realtime атомарно создаёт notification и exact per-device delivery
attempt. Isolated sender выполняет fresh permission check до decrypt,
lease/retry, `404/410` terminal expiry и global provider-expiry sweep.
Persistent canaries запрещают same-version replacement keyring bytes.
Production profile и test send по умолчанию выключены до операторских VAPID
credentials/canary; общий notification email/digest ещё не реализован.

Transactional email срез по ADR-2026-038 реализует отдельный путь для
подтверждения email, password reset, workspace invite и NPD receipt. Platform API пишет
secret-free events и публикует их в `AUTH_EMAIL_EVENTS`; отдельный
`auth-email-worker` получает JIT recipient/action URL через защищённый
Platform API boundary, отправляет SMTP и хранит только durable redacted state
в `jobs_db.auth_email_delivery_attempts`. Одноразовый token не попадает в
outbox/NATS/Jobs DB и передаётся Web только во fragment. Фактическая
production-доставка остаётся operator gate: SMTP credentials/provider/sender
в repository отсутствуют и должны быть отдельно настроены и проверены.

Identity terminal-revoke pipeline по ADR-2026-036 теперь замкнут через
durable transport для `identity.session-family.revoked.v1`. Platform API
terminal-отзывает целые session families и атомарно пишет redacted outbox;
bounded global expiry sweeper под тем же user advisory lock повторно проверяет
due family и вызывает общий revoke/outbox helper. Durable publisher выбирает
только этот event type через `FOR UPDATE SKIP LOCKED`, заново валидирует exact
envelope, публикует с `Nats-Msg-Id = outbox event id` и переводит запись в
`PUBLISHED` только после exact JetStream PubAck; retry/terminal failure и
shutdown bounded. Realtime durable pull consumer проверяет exact topology и
envelope, commit-ит `inbox + tombstone + device revoke` до source ack,
использует bounded delayed NAK и redacted DLQ, а при shutdown оставляет
незавершённое сообщение unacked. One-shot provisioner создаёт exact singleton
source/DLQ streams и durable consumer до старта приложений; publisher,
consumer, provisioner и остальные NATS runtimes имеют разные credentials и
least-privilege ACL. Broker получает только пять bcrypt verifier записей,
plain client passwords остаются у exact приложений/preflight. Общий email/
digest sender по-прежнему отсутствует; browser Web Push имеет отдельный
durable sender, а transactional auth-email worker не использует notification
preferences или digest.

Межсервисный HTTP hardening удалил legacy `INTERNAL_API_TOKEN`: каждый
обычный caller/audience pair теперь имеет отдельный credential, а legacy env
останавливает startup. Dedicated vault, rank manifest/result/grant и Web Push
device boundaries сохранены отдельно. Все internal clients запрещают
redirect, а service-token guards требуют один strict header. До запуска
credential-bearing processes и NATS Compose выполняет network-less one-shot
`service-token-preflight`: он глобально проверяет 27 credentials и отдельно
пять NATS bcrypt verifier и пять usernames без вывода значений или хэшей.
Jobs image дополнительно
получил явные process roles:
HTTP имеет полный management-набор только для своей роли, import —
DB/Redis/S3/SEO Data, inspection —
DB/Redis/S3/malware, system — Redis-only; rank и connector сохраняют прежние
строгие specialized allowlists, а auth-email worker получает только
`jobs_auth_email_runtime`, dedicated NATS/Platform credentials и SMTP без
Redis/general Jobs capabilities. Это закрывает credential fan-out через env,
но не означает полной production готовности: source-built Redis compatibility
подтверждена, однако pinned OCI startup, observability, общий notification
sender, live smoke с пользовательским Arsenkin BYOK credential и остальные
release gates остаются.

Этот файл является короткой оперативной картой. Полные требования находятся в [`docs/technical-spec/00-index.md`](./docs/technical-spec/00-index.md).

## 1. Инварианты

- Tenant: `workspace`; проект всегда принадлежит одному workspace.
- Backend-контуры: platform API, SEO data, jobs/integrations, realtime.
- Каждый backend владеет своей PostgreSQL database.
- Межсервисные IDs — UUIDv7; cross-database foreign keys запрещены.
- Синхронные связи — internal HTTP; надёжные события — NATS JetStream + outbox/inbox.
- Долгие операции — BullMQ/Redis.
- Большие файлы — S3-compatible object storage.
- Общий notification email подключается через port/adapter и может быть
  выключен; выделенный production auth-email worker запускается только с
  полной operator-managed SMTP configuration.
- Frontend не обращается к domain services напрямую: публичный вход — platform API.
- Platform-paid SEO API запрещён без price book, budget и коммерческого права.
- Основной домен обслуживает единый `platform-web`; `/app` private/noindex.
- Public/project Toolbox и API используют один capability registry.
- Billing никогда автоматически не удаляет проекты и не скрывает историю.
- Чек НПД создаётся только для verified успешного платежа ЮKassa.
- Настройки каналов уведомлений принадлежат профилю пользователя; проектные
  подписки задают типы работ и могут только сужать/переопределять профиль.
- Browser Push device принадлежит профилю, а не проекту; project rule выбирает
  события/канал, но не получает endpoint или browser keys.
- Terminal session revoke применяется ко всей refresh family и атомарно пишет
  `identity.session-family.revoked.v1`; обычная rotation и access-token TTL
  terminal event не создают. Rotation сохраняет исходные `authenticatedAt` и
  absolute `expiresAt` family и зажимает новый access TTL этим сроком.
- Tracking context не хранит provider/credential/schedule: его immutable
  search configuration принадлежит SEO data, routing — Jobs, schedule —
  automation.
- Rank manifest принадлежит SEO Data, остаётся immutable после seal и
  закрывается без физического удаления после terminal finalize.

## 2. Development workspace

Канонический source хранится в одном GitHub monorepo по ADR-2026-037. Каждый
`platform-*` каталог остаётся независимой package/deployable/data-ownership
boundary и при реальной операционной необходимости может быть снова выделен
через `git subtree split`. Общий Git не разрешает межсервисный доступ к БД или
импорт доменной реализации вместо contracts.

| Каталог | Ответственность | Deployable |
|---|---|---|
| `platform-contracts` | HTTP/event/error contracts без бизнес-логики | npm package |
| `platform-api` | auth, workspace, project, billing, API gateway | да |
| `platform-seo-data` | semantics, pages, positions, competitors | да |
| `platform-jobs-integrations` | jobs, workers, connectors, S3/email ports | несколько entrypoints |
| `platform-realtime` | WebSocket presence/collaboration delivery | да |
| `platform-web` | public site, Toolbox, API docs и приложение `/app` | да |
| `platform-admin` | защищённая operations-панель НПД и platform roles | да, отдельный edge origin |
| `platform-infrastructure` | Compose/Dokploy, monitoring, runbooks | конфигурация |
| `.github/workflows/ci.yml` | Node.js 24 workspace quality gate | GitHub Actions |
| `docs/technical-spec` | нормативное ТЗ | нет |
| `semaflow-seo-platform-design` | исходный статический дизайн-прототип | нет |

## 3. Текущие связи

```text
platform-web ──────┐
platform-admin ────┼──> platform-api
                               │
                               ├──> platform-seo-data
                               ├──> platform-jobs-integrations
                               └──> platform-realtime

HTTP/domain backends <──> NATS
jobs/realtime <──> Redis
jobs <──> S3
upload inspection worker ──> ClamAV
import worker ──> S3 + partitioned staging in jobs_db
import worker ──internal HTTP──> seo-data semantic core
crawl worker ──> public HTTP(S) + jobs_db/Redis + seo-data snapshots
connector worker ──> jobs_db + BullMQ + allowlisted provider endpoints
platform-api outbox ──> AUTH_EMAIL_EVENTS ──> auth-email worker ──> SMTP
auth-email worker ──internal HTTP/JIT──> platform-api
platform-web public/docs <──> Directus
```

Platform API синхронно передаёт обычные upload/import-команды в
jobs-integrations через internal HTTP с
`PLATFORM_API_TO_JOBS_TOKEN` и проверенным tenant/actor context. Credential,
binding и связанные rank command endpoints используют отдельный
`PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN`, доступный только Platform API и
jobs-integrations HTTP; general token vault не открывает.
Проверка credential создаётся как канонический `Job` в PostgreSQL; BullMQ
получает только `jobId`. Отдельный execution-role connector worker забирает
lease и перед вызовом провайдера повторно проверяет workspace, material
version, connector version и состояние credential.
Execution login не читает `jobs` или `integration_credentials` напрямую:
allowlisted `SECURITY DEFINER` broker выдаёт due IDs, lease с одноразовым
token и только encrypted projection credential, привязанную к точной
validation job. Success/provider failure завершают Job и credential атомарно,
а local decrypt/KEK failures используют отдельный job-only finish.
Project binding читается и изменяется через Platform API, а хранится только
в jobs/integrations. Public body не задаёт tenant/actor context; Platform API
передаёт его через тот же dedicated credential boundary и строго проверяет
scope/safe response перед возвратом в Web.
Tracking context читается и изменяется через Platform API, а хранится только
в SEO Data. Platform API передаёт проверенный tenant/actor context по internal
HTTP с `PLATFORM_API_TO_SEO_DATA_TOKEN`; SEO Data повторно сверяет
route/project scope и атомарно пишет redacted outbox event вместе с domain
change. Jobs HTTP, import и crawl worker обращаются к SEO Data только с отдельным
`JOBS_TO_SEO_DATA_TOKEN`. Realtime general HTTP принимает от Platform API
`PLATFORM_API_TO_REALTIME_TOKEN`, а browser device lifecycle — отдельный
notification credential.
Оценка готовности позиций вызывается Web через Platform API. Platform API
загружает trusted project/workspace/access snapshot и передаёт команду в
Jobs/integrations через dedicated credential boundary. Jobs запрашивает у
SEO Data атомарный bounded scope, читает только allowlisted connector
metadata и сохраняет immutable redacted receipt в `rank_estimates`. Exact
replay не продлевает TTL и не повторяет SEO read; estimate не является
execution grant.
Перед будущим provider submit Jobs должен запросить Platform API через
`POST /internal/v1/workspaces/:workspaceId/projects/:projectId/rank-execution-grants`.
Issuer требует exact single-value request/tenant/actor/idempotency headers,
сверяет их с path/body и сохраняет immutable decision в
`platform_db.rank_execution_grant_receipts`. Exact replay возвращает исходный
receipt даже после expiry. Jobs теперь до вызова issuer сохраняет exact
request/scope/evidence и stable idempotency key в
`jobs_db.rank_execution_grant_attempts`, а затем под теми же canonical graph
locks проверяет решение и DB clock. Отказы заканчиваются persisted
`DENIED/EXPIRED/REJECTED_LOCAL`; валидный grant проходит промежуточный
`GRANTED_PENDING_CONSUME` и атомарно создаёт единственную scoped
`rank_connector_executions` row вместе с `CONSUMED`. Ни эта row, ни consume
не разрешают provider call. SECURITY DEFINER claim повторно проверяет
lifecycle/credential/control и создаёт только pre-network lease. Exact
authorize operation повторяет full graph/control/fence recheck и commit-ит
`SUBMITTING` с one-way marker; permission script выдаёт обе функции connector
login, но runtime process path их пока не вызывает.
Platform API теперь имеет глобальную fail-safe HTTP response policy: кроме
exact public GET/HEAD health/system allowlist, auth/tenant/internal, unknown,
parser/guard/exception/404 ответы принудительно получают
`Cache-Control: private, no-store` и merge-safe `Vary`. Все ответы получают
nosniff/frame/referrer/permissions headers; production HSTS зависит от
effective HTTPS через ровно один доверенный reverse-proxy hop.
История позиций читается Web только через same-origin BFF и public Platform
API `GET /api/v1/projects/:projectId/rank-history`. Platform API проверяет
session, `ranking.view` и tenant scope, затем передаёт trusted context и
bounded UTC/filter/cursor query во внутренний read model SEO Data. Чтение
остаётся доступным для архивного проекта и billing read-only workspace.
Для `identity.session-family.revoked.v1` межсервисный transport включён:
Platform API durable publisher, JetStream topology и Realtime durable consumer
проверяют exact subject/stream/consumer и fail-closed readiness. Остальные
event families этот identity consumer намеренно не получает. Тот же Platform
outbox publisher отдельным allowlist публикует четыре transactional-email
event type в `AUTH_EMAIL_EVENTS`; durable `jobs_auth_email_v1` обрабатывает их
отдельным worker. Остальные event families пока имеют только локальные
outbox/inbox foundations либо собственные producer rows.

## 4. Порты по умолчанию

| Компонент | Порт |
|---|---:|
| unified web | 3000 |
| admin | 3002 |
| platform-api | 4000 |
| seo-data | 4001 |
| jobs-integrations API | 4002 |
| realtime | 4003 |
| Directus | 8055 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS client/monitor | 4222 / 8222 |
| ClamAV `clamd` (только internal network) | 3310 |

## 5. Конфигурация

- Корневой `.env.example` документирует remote compose variables.
- Каждый сервис имеет собственный `.env.example`.
- Runtime validation должна завершать startup при отсутствии обязательной переменной.
- `S3_ENABLED=false` и `EMAIL_ENABLED=false` разрешены до подключения провайдеров.
- Имена access/session/CSRF cookies в `platform-web` и `platform-api` обязаны
  совпадать; публичным для JavaScript является только имя CSRF cookie.
- Directus использует local media volume до переключения
  `DIRECTUS_STORAGE_DRIVER=s3`; application uploads сразу имеют S3 adapter.
- Production secrets задаются только в Dokploy.
- Legacy `INTERNAL_API_TOKEN` удалён из deploy input и отклоняется startup
  всех четырёх backend. General internal HTTP разделён на exact pairs:
  `PLATFORM_API_TO_SEO_DATA_TOKEN` (Platform API → SEO Data),
  `PLATFORM_API_TO_JOBS_TOKEN` (Platform API → Jobs HTTP),
  `JOBS_TO_SEO_DATA_TOKEN` (Jobs HTTP/import/crawl → SEO Data) и
  `PLATFORM_API_TO_REALTIME_TOKEN` (Platform API → Realtime).
- `PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN` отличается от general tokens и
  выдаётся только Platform API и credential-capable jobs/integrations HTTP
  process.
- `JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN` отличается от general/rank/
  notification credentials и выдаётся только Platform API и
  `auth-email-worker`. Он защищает только JIT material/completion routes и не
  даёт Jobs читать `platform_db` напрямую.
- Service-token validation принимает только `32..512` visible ASCII без
  whitespace/control/comma, отклоняет example placeholders и reused values.
  Guard принимает один exact header и сравнивает credential timing-safe;
  internal clients используют `redirect: "error"`.
- Deploy-level `service-token-preflight` намеренно строже runtime validation:
  до запуска credential-bearing processes он проверяет 26 deploy credentials
  (одиннадцать service tokens, `RANK_HISTORY_CURSOR_KEY`, девять Redis passwords и
  пять NATS passwords)
  на глобальную pairwise distinctness, пять NATS bcrypt verifier с
  canonical `$2a$` prefix/cost `11` на format/раздельность и пять NATS
  username на отдельную уникальность и несовпадение с credentials. Secrets
  допускают только
  URL-safe `[A-Za-z0-9._~-]` длиной `32..512`; NATS password начинается с
  ASCII letter, username является ASCII identifier длиной `3..64`. One-shot
  container не имеет сети, работает read-only с `cap_drop: ALL` и
  `no-new-privileges` и не пишет в output значения либо их хэши; ошибки
  называют только переменные.
- NATS deploy identities разделены на deny-all generic runtime,
  `platform-api` publisher, Realtime consumer, Jobs auth-email consumer и
  one-shot topology provisioner.
  Apps получают привычные `NATS_USER/NATS_PASSWORD` только через exact Compose
  mapping, тогда как broker получает только соответствующие bcrypt verifier
  env. Production требует explicit safe `NATS_EVENT_ENVIRONMENT`, а
  publisher/consumer и bounded global session expiry sweeper нельзя отключить.
- Redis разделён на три непубликуемых instance/network: durable
  `redis-jobs` с AOF и `noeviction`, ephemeral Pub/Sub `redis-realtime` и
  ephemeral cache `redis-directus`. Default user выключен; отдельный health
  user имеет только `PING`. Wrapper до privilege drop копирует выбранный
  config и атомарно рендерит ACL в dedicated runtime tmpfs, выставляет
  `redis:redis 0700/0600`; ACL содержит только SHA-256 password hashes.
  Семь Jobs identities ограничены exact versioned BullMQ keyspaces
  `seo-platform:jobs:v1:*`, Realtime не имеет key access и получает только
  exact Socket.IO channels `seo-platform:realtime:v1`. Jobs
  `maxmemory=256 MiB` работает под container cap `768 MiB`, оставляя headroom для AOF rewrite
  и fragmentation; load/target-host evidence всё равно обязательно.
- `JOBS_TO_PLATFORM_RANK_GRANT_TOKEN` защищает только internal issuer
  execution grants и отличается от всех остальных service tokens. Текущий
  Compose передаёт его только Platform API и выделенному rank-worker с
  bounded Jobs grant client. Generic Jobs HTTP, connector/import/inspection/
  system/migration, Web и остальные сервисы его не получают.
- `JOBS_TO_SEO_RANK_TOKEN` отличается от всех остальных service tokens и
  защищает seal/chunk boundary с plaintext keyword snapshots. До появления
  provider execution его получают только SEO Data HTTP и отдельный
  `rank-worker`; generic HTTP, connector, import, inspection, system и
  migration processes его не получают.
- `JOBS_TO_SEO_RANK_RESULT_TOKEN` защищает отдельную запись уже
  нормализованных результатов и не переиспользует preparation credential.
  Текущий Compose требует его и передаёт только SEO Data и isolated
  rank-worker result producer; connector, generic HTTP, import, inspection,
  system и migration processes secret не получают.
- `RANK_HISTORY_CURSOR_KEY` — отдельный HMAC key непрозрачного history
  cursor. Текущий Compose требует и передаёт его только SEO Data; Platform
  API, Web, workers и migration processes key не получают.
- Rank-worker требует `RANK_PREPARATION_ENABLED=true`, отдельные bounded
  lease/dispatch/concurrency settings и lease минимум на пять секунд длиннее
  SEO Data timeout. Он запускается отдельным Dokploy process из того же image
  и fail-closed отклоняет generic/credential/NATS/S3/SMTP secrets.
- Jobs process roles проверяются config loader-ом fail-closed. HTTP получает
  DB/Redis/NATS/S3/SMTP, два нужных general tokens и management vault; import
  — DB/Redis/S3/SEO token; inspection — DB/Redis/S3/malware; system — только
  Redis. Rank и connector используют прежние strict allowlists и не получают
  general tokens. Auth-email получает только scoped Jobs DB, dedicated NATS/
  Platform credentials и SMTP; Redis, general tokens, vault, S3 и malware
  configuration запрещены.
- `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN` отличается от остальных
  service secrets и выдаётся только Platform API и Realtime HTTP для
  управления browser Web Push devices. Пример намеренно пуст, runtime
  отклоняет placeholder, а production Compose требует явно сгенерированное
  значение.
- `REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN` выдаётся только isolated
  `web-push-worker` и Platform API. Worker использует его для fresh
  user/workspace/project/membership permission check непосредственно перед
  decrypt/send; Realtime HTTP и другие процессы credential не получают.
- Browser subscription material использует отдельные versioned keyrings
  `WEB_PUSH_SUBSCRIPTION_KEYS` (AES-256-GCM) и
  `WEB_PUSH_FINGERPRINT_KEYS` (HMAC-SHA-256). Их key material не
  переиспользуется, отображение version → bytes immutable, active rows
  проходят startup coverage guard. Таблицы
  `web_push_encryption_key_canaries` и
  `web_push_fingerprint_key_canaries` persistent-проверяют bytes каждой
  версии; sender имеет к ним только `SELECT`.
- `WEB_PUSH_ENDPOINT_ORIGINS` является exact HTTPS origin allowlist.
  `WEB_PUSH_REGISTRATION_ENABLED=false` — безопасный default; VAPID private
  key передаётся только Compose profile `web-push` isolated sender role и не
  попадает в Platform API, Realtime HTTP или Web.
- BYOK envelope encryption использует отдельный
  `INTEGRATION_CREDENTIAL_KEYS` KEK keyring; auth encryption key для него не
  переиспользуется. Request fingerprint использует второй независимый
  `INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS` keyring. Management-role HTTP
  process получает оба keyring для create/rotate, execution-role connector
  worker получает только KEK для расшифровки перед allowlisted provider call;
  generic migration/system/import/inspection workers не получают ни один.
  Привязка `keyVersion → KEK bytes` immutable: существующей версии запрещено
  присваивать другое значение. Startup проверяет не tenant credential sample,
  а immutable synthetic envelope из `integration_credential_kek_canaries`;
  таблица не содержит workspace, provider или credential identity.
- Runtime role guard работает fail-closed: `DISABLED` отклоняет credential
  secrets, а `EXECUTION` — management/fingerprint/internal/NATS и S3/SMTP
  secrets. Это проверка конфигурации, а не криптографическая изоляция.
- Connector worker требует `INTEGRATION_CREDENTIAL_ROLE=EXECUTION` и
  canonical DB username `jobs_connector` с отдельным вращаемым
  `JOBS_CONNECTOR_DATABASE_PASSWORD`, а также
  `INTEGRATION_VALIDATION_TIMEOUT_MS`, `INTEGRATION_VALIDATION_LEASE_SECONDS`,
  `INTEGRATION_VALIDATION_DISPATCH_SECONDS`,
  `INTEGRATION_VALIDATION_CONCURRENCY`. Lease должен быть строго длиннее
  provider timeout минимум на 2 секунды; startup проверяет инвариант.
- Jobs runtime processes используют `internal` для PostgreSQL/NATS,
  отдельную `jobs-redis` для Redis и непубликуемую `outbound` network для
  S3/SMTP/provider HTTPS.
  Connector origins фиксированы в коде; production egress proxy/firewall
  остаётся дополнительным сетевым allowlist.
- SMTP deploy inputs разделены: только `AUTH_EMAIL_SMTP_*` маппятся в
  process-local `SMTP_*` auth-email worker, а Directus получает только
  `DIRECTUS_SMTP_*`. Общие SMTP credentials и выдача обоих наборов одному
  process запрещены.
- `inspection` Compose profile запускает отдельные ClamAV и upload inspection
  worker; без доступного scanner файл fail-closed остаётся `UPLOADED`.

## 6. Внутренняя структура пакетов

Backend convention:

- `src/config` — единственная точка чтения и проверки env;
- `src/database` + `prisma` — Prisma adapter, schema и migrations владельца БД;
- `src/messaging` — NATS transport; domain code не импортирует transport напрямую;
- `src/health` — liveness/readiness;
- `src/system` — временный descriptor возможностей;
- `src/generated` и `dist` — генерируемые, не редактируются вручную.

Специализированные модули:

- `platform-api/src/identity` — account/session lifecycle, user-scoped
  advisory lock, whole-family terminal revoke/outbox, bounded global
  refresh-family expiry sweeper, encrypted user-bound keyset pagination
  активных сессий и CSRF guards;
- `platform-api/prisma/migrations/20260730160000_preserve_session_family_lineage`
  — atomic user+family backfill исторических rotation rows до минимальных
  `authenticated_at`/`expires_at`, чтобы legacy family не обходила recent-auth
  и absolute TTL;
- `platform-api/src/common/uuid-v7.ts` — dependency-free RFC 9562 UUIDv7 для
  новых межсервисных session-family aggregate IDs;
- `platform-api/src/common/http-response-policy.ts` — глобальная exact-public-
  allowlist response boundary: private/no-store и merge-safe Vary для всех
  остальных route/error paths, общие security headers и production HSTS
  только при effective HTTPS от ближайшего доверенного proxy hop;
- `platform-jobs-integrations/src/internal/http-response-policy.ts` и
  `platform-seo-data/src/internal/http-response-policy.ts` — fail-safe
  private/no-store boundary для всех внутренних HTTP, parser/guard/error/404
  ответов с merge-safe Vary и security headers; оба internal-only сервиса не
  доверяют forwarded proxy headers;
- `platform-realtime/src/common/http-response-policy.ts` — edge HTTP/error/
  preflight boundary Realtime с принудительным private/no-store, merge-safe
  Vary, security headers и production HSTS только по effective HTTPS от
  ближайшего из одного доверенного proxy hop;
- `platform-api/src/identity/mfa.*`, `totp.*` — TOTP lifecycle, login
  challenge и recovery codes;
- `platform-contracts/src/events/transactional-email.ts` и
  `src/api/auth-email-deliveries.ts` — exact secret-free transactional-email events,
  subjects/redacted DLQ и JIT material/completion contracts;
- `platform-api/src/auth-email` — dedicated guard/controller и authoritative
  JIT materializer: повторная проверка user/token/invite/workspace state,
  восстановление token только в памяти, fragment-only action URL и
  idempotent invite/NPD receipt completion;
- `platform-api/src/authorization` — default-deny permission catalog и
  проверка tenant context;
- `platform-api/src/billing` — versioned plan catalog, trial/subscription,
  YooKassa checkout/webhook/reconciliation/autopay/refund, encrypted buyer
  PII, manual-NPD obligations, append-only double-entry ledger и общий
  transaction-scoped entitlement guard для projects/seats/CLIENT/BYOK;
- `platform-api/src/admin` — обязательный MFA/recent-auth guard поверх
  persisted platform roles, одноразовый fail-closed bootstrap первого
  `SUPER_ADMIN`, bounded NPD queue/detail, audited PII access, manual
  registration/cancellation/replacement и role assignment/revocation;
- `platform-api/src/tenants` — workspace/project commands и queries;
- `platform-api/src/tenants/team.*` — tenant-bound cursor pagination,
  приглашения, участники и проектные ограничения доступа;
- `platform-api/src/uploads` — project-scoped public upload commands;
- `platform-api/src/jobs` — internal HTTP client к jobs-integrations с
  отдельным general и credential audience token и запретом redirect;
- `platform-api/src/integrations` — workspace-scoped public catalog/credential
  commands и project-scoped connector settings с RBAC, CSRF, audit intent,
  idempotency и optimistic locking;
- `platform-api/src/imports` — project-scoped create/read orchestration с
  `semantic.import`/`semantic.view`;
- `platform-api/src/semantics` — public project-scoped keyword read/create/
  update/delete, bounded explicit-ID bulk и cleaner preview/apply,
  иерархические groups и versioned
  manual clusters, private/project-shared saved views, а также typed custom
  column/value CRUD;
  reads используют `semantic.view`, definitions защищены
  `semantic.manage_custom_columns`, mutations — CSRF, tenant lifecycle,
  optimistic locking и audit;
- `platform-api/src/rankings` — public tracking context CRUD/archive/restore
  и point keyword assignments с `ranking.view/configure`, CSRF,
  idempotency/OCC и audit, а также provider-free rank estimate с
  `ranking.view` и trusted lifecycle/access snapshot, public manual Job
  lifecycle, bounded read-only rank history proxy, audited rank-tracking
  automation CRUD/pause/resume/manual-run/history и protected controlled-beta
  execution-grant issuer с immutable exact replay;
- `platform-contracts/src/api/automations.ts` — public/internal schedule,
  capacity, manual command и bounded run-history contracts без provider
  credential material;
- `platform-contracts/src/api/rank-execution-grants.ts` — exact Jobs →
  Platform request/scope hash preimages, 30-second grant/decision contracts и
  redaction allowlist без binding/credential/secret IDs;
- `platform-api/prisma/migrations/20260729230000_rank_execution_grant_receipts`
  — immutable issuer decisions, exact idempotency/item-attempt keys,
  authoritative quota reservation и update/delete/truncate guards;
- `platform-api/prisma/migrations/20260730223000_rank_beta_quota_reservations`
  — immutable controlled-beta UTC-day reservations, workspace limit
  `200 RANK_PROVIDER_TASK/day` и составной receipt binding FK;
- `platform-jobs-integrations/prisma/migrations/20260729230100_rank_execution_grant_attempts`
  — durable exact Jobs intent/decision history, tenant-safe Job/Run/Item FK,
  immutable request identity, state matrix и delete/truncate guards;
- `platform-jobs-integrations/prisma/migrations/20260729230200_rank_connector_executions`
  — secret-free scoped execution rows, tenant Job/item/grant/connector FK,
  current-graph insert guard и deferred one-to-one atomic
  `CONSUMED ↔ READY_TO_SUBMIT` invariant;
- `platform-jobs-integrations/prisma/migrations/20260730101500_rank_connector_execution_claim`
  — default-closed control и immutable kill-switch version history, bounded
  `READY_TO_SUBMIT → CLAIMED` lease, full eligible-graph/canonical-lock
  SECURITY DEFINER claim и exact encrypted credential projection; `PUBLIC`
  execute отозван;
- `platform-jobs-integrations/prisma/migrations/20260730101600_integration_credential_validation_broker`
  — synthetic immutable KEK canaries и узкие SECURITY DEFINER due/claim/
  finish boundaries, которые убирают direct global vault read connector роли;
- `platform-jobs-integrations/prisma/migrations/20260730101700_rank_connector_submitting_enum`
  и `20260730101800_rank_connector_submit_authorization` — отдельный enum
  expansion, monotonic lease generation, one-way `CLAIMED → SUBMITTING`,
  full graph/control/fence authorization и durable may-have-started marker;
- `platform-jobs-integrations/prisma/migrations/20260730120000_rank_provider_request_intents`
  — один append-only exact provider request intent на JobItem, bounded JSONB,
  tenant-safe Job/Run/Item FK, update/delete/truncate guards и обязательный
  составной execution FK по intent/request/manifest/chunk hashes;
- `platform-jobs-integrations/prisma/migrations/20260730120100_rank_runtime_database_boundary`
  — fail-closed RLS domain scope для выделенного `jobs_rank_runtime`,
  column-level vault projection без ciphertext/DEK и DB guards, запрещающие
  реальные writes в validation/lock-only rows при сохранении `FOR UPDATE`;
- `platform-contracts/src/api/rank-runs.ts` и `src/events/rankings.ts` —
  exact manual-run lifecycle, manifest/chunk, normalized ingest/finalize и
  redacted completion event contracts; manifest preimage builders
  используются Jobs и SEO Data, Job preparation/cancel и SEO Data
  ingest/finalize/completion outbox реализованы; provider-side normalized
  result producer остаётся следующей runtime-границей;
- `platform-contracts/canonical-json` — server-only RFC 8785 JCS subpath для
  одинаковых contract hash preimages в Jobs и SEO Data; root/browser export
  намеренно отсутствует;
- `platform-api/src/seo-data` — строго валидируемый internal read/command
  client к владельцу semantic core и tracking contexts;
- `platform-seo-data/src/rank-manifests` — dedicated-auth seal/chunk API,
  bounded preflight, immutable manifest state machine, hash verification и
  active semantic dedup;
- `platform-seo-data/src/rank-results` — dedicated-auth normalized chunk
  ingest, append-only snapshots/current projection, terminal finalize
  receipts/completion outbox и internal HMAC-cursor history;
- `platform-seo-data/prisma/migrations/20260729160000_rank_execution_manifests`
  — header/chunk/entry tables, provenance/immutability triggers и partial
  unique active-dedup index;
- `platform-api/src/notifications` — public profile/project notification
  preferences с CSRF, tenant authorization и optimistic locking, а также
  profile-scoped browser device lifecycle с recent-auth enable;
- `platform-api/src/realtime` — строго валидируемый internal client владельца
  notification policy и encrypted browser subscription storage;
- `platform-api/src/audit`, `src/outbox` — переиспользуемые transactional
  записи аудита и событий; текущий durable publisher выбирает exact terminal
  identity event в `IDENTITY_EVENTS` и четыре transactional-email events в
  `AUTH_EMAIL_EVENTS`, проверяет expected stream PubAck и сохраняет bounded
  retry/terminal status в той же outbox;
- `platform-jobs-integrations/src/queue` — BullMQ connection с единым
  versioned key prefix `seo-platform:jobs:v1`, system, `upload-inspection`,
  идемпотентная `integration-credential-validation` и DB-recoverable
  `rank-preparation` queues и versioned rank automation Job Scheduler;
- `platform-jobs-integrations/src/automations` — tenant-safe versioned
  definitions, plan capacity lock, scheduler reconciliation, manual/scheduled
  execution через существующие rank estimates/runs, no-overlap, crash
  recovery, terminal settlement и failure-threshold auto-pause;
- `platform-jobs-integrations/prisma/migrations/20260731110000_rank_tracking_automations`
  — actor/idempotency provenance для definitions и durable automation run
  lifecycle с immutable execution snapshot, trigger matrix и tenant/status
  indexes;
- `platform-jobs-integrations/src/storage` — S3 port, disabled и S3 adapters;
- `platform-jobs-integrations/src/malware` — scanner port, disabled adapter и
  потоковый `clamd` INSTREAM adapter;
- `platform-jobs-integrations/src/internal` — strict single-header
  `PlatformApiGuard` для general Platform API → Jobs HTTP-команд;
- `platform-jobs-integrations/src/uploads` — multipart lifecycle, opaque
  object keys, size verification, lease/heartbeat inspection и upload outbox
  events;
- `platform-jobs-integrations/src/imports` — потоковый CSV/TSV parser,
  Key Collector header mapping, raw/validated staging, lease/heartbeat,
  validation summary и chunked publisher;
- `platform-jobs-integrations/src/keyword-research` — production BYOK
  collection органических запросов конкурента через документированный
  Keys.so `organic/keywords`: tenant/idempotency boundary, bounded
  page evidence и preview rows, один provider request на delivery,
  lease-fenced connector broker, explicit row selection и идемпотентный
  импорт выбранного в SEO Data с актуальным plan entitlement;
- `platform-jobs-integrations/prisma/migrations/20260801003000_keyword_research`
  — `keyword_research_runs/pages/rows`, tenant-safe Job/binding/route/
  credential FKs, lifecycle/value constraints и три exact
  `SECURITY DEFINER` функции без table DML у connector role;
- `platform-jobs-integrations/src/frequency-collections` — асинхронный
  `FREQUENCY_COLLECTION` Job для 1–200 явных keyword ID/version через XMLStock
  Wordstat BYOK. Job/JobItem содержат только ссылки и параметры; connector
  получает encrypted credential только через exact `SECURITY DEFINER` claim,
  расшифровывает его в памяти, собирает BASE/EXACT/FIXED и сохраняет
  normalized snapshots через отдельную Jobs → SEO Data границу. Retry,
  частичный результат, отмена и server-side history видны в журнале операций;
- migration `20260801144000_frequency_collection_runtime` добавляет три exact
  broker-функции claim/complete/fail без table DML у connector role, а
  `platform-infrastructure/postgres/permissions/jobs-connector.sql` включает
  только эти сигнатуры в allowlist;
- `platform-seo-data/src/frequencies` и migration
  `20260801143000_frequency_snapshot_job_idempotency` — owner-side resolve
  keyword version и идемпотентная запись snapshot по
  tenant/project/job/keyword/type/region/device; snapshot сохраняет device,
  optional period и finite quality flags, а импорт без полного контекста
  маркируется `CONTEXT_INCOMPLETE`. Keyword insights объединяет bounded
  frequency history и current rank projections для правого inspector;
- `platform-api/src/keyword-research` и
  `platform-web/app/app/(protected)/competitors` — public
  `competitor.view/manage` + `collector.run/cancel`, CSRF/OCC/audit/billing
  boundary и private UI `сбор → preview → выбор → импорт` со всеми
  документированными Keys.so base codes, polling/error/empty/read-only
  states и ссылкой на настройку BYOK;
  `keyword-research-connector-setup.tsx` создаёт/изменяет capability binding
  `COMPETITOR_RESEARCH` прямо в рабочем сценарии и разрешает только
  проверенный active Keys.so BYOK credential;
- `platform-jobs-integrations/src/integrations` — allowlisted provider catalog,
  workspace-scoped envelope vault с per-record DEK, AES-256-GCM и versioned
  KEK, отдельный versioned HMAC fingerprint keyring, dedicated caller guard,
  synthetic immutable KEK canary, startup coverage guard, masked DTO,
  rotation, destructive secret overwrite при revoke, connector registry,
  narrow execution broker с token/version-fenced lease/finish operations и
  нормализованные project binding/route/create receipt;
- `platform-jobs-integrations/src/rank-estimates` — immutable provider-free
  estimate receipts, strict tenant/idempotency boundary, connector metadata
  projection и finite blockers без provider call/decrypt/queue;
- `platform-jobs-integrations/src/rank-runs` — internal create/get/cancel,
  immutable manifest command/hash, `rank_job_runs` sidecar, явная Job/seal
  state machine, canonical `Job → RankJobRun → JobItem → provider intent →
  credential → validation Job → binding → route → grant attempt` lock order,
  bounded recovery, public-safe Job projection, exact private provider
  request intent, durable execution-grant intent/consume и PostgreSQL
  recovery dispatcher для `QUEUED → RUNNING`/per-chunk grant/failure
  finalization; documented Arsenkin adapter, durable submit/poll/stage state,
  normalized result persistence и terminal Job/manifest finalizer. Provider
  lifecycle запрещает auto-resubmit после ambiguous submit и переводит такой
  исход в проверяемый `ACTION_REQUIRED`;
- `platform-jobs-integrations/src/crawls` — tenant-scoped crawl Job sidecar,
  SSRF/DNS-rebinding-safe HTTP client, streaming HTML analysis, robots rules,
  bounded XML/XML.GZ sitemap/index traversal, include/exclude/query scope,
  conditional HTTP validators, global host backoff,
  PostgreSQL lease/checkpoint/retry recovery и secret-free BullMQ payload;
- `platform-jobs-integrations/src/crawl-automations` и
  `src/queue/crawl-automation.queue.ts` — versioned Radar schedule CRUD,
  quiet-window/host/no-overlap admission, dedicated fresh authorization
  dispatch, BullMQ reconciliation, terminal settlement и auto-pause;
- `platform-jobs-integrations/src/crawl-notifications` — dispatcher terminal
  `technical-crawl.notification.requested.v1` из существующего outbox с
  bounded lease/retry и idempotent Platform delivery;
- `platform-jobs-integrations/prisma/migrations/20260731233000_crawl_automations`
  — tenant-safe definitions/runs, immutable schedule provenance, lifecycle,
  trigger/idempotency/chronology constraints и crawl/Job FKs;
- `platform-jobs-integrations/prisma/migrations/20260731230100_crawl_host_backoff`
  — global per-host failure/latency state и durable per-crawl
  `backoffCode/backoffUntil`;
- `platform-jobs-integrations/prisma/migrations/20260801030000_crawl_site_pause`
  — additive `SITE_PAUSED` state для durable technical crawl projection;
- `platform-seo-data/src/crawls` — immutable crawl snapshots/issue
  occurrences/page changes с sitemap membership, current issue projection,
  deterministic before/after diff, идемпотентный анализ duplicate groups по
  content hash/нормализованным Title/Description/H1, exact-scope membership
  comparison с immutable evidence исчезнувших страниц и tenant-safe Page Map
  update без raw HTML;
- `platform-seo-data/prisma/migrations/20260731230000_crawl_conditional_requests`
  — bounded HTTP validators и tenant-bound immutable snapshot reuse evidence;
- `platform-seo-data/prisma/migrations/20260801010000_crawl_duplicate_groups`
  — immutable crawl analysis receipt, bounded duplicate groups/members,
  составные tenant/project/crawl FK и current issue projection;
- `platform-seo-data/prisma/migrations/20260801020000_crawl_membership_absences`
  — exact-scope terminal analysis, immutable absence evidence, tenant-safe
  predecessor/snapshot/Page FK и bounded membership counts;
- `platform-api/src/crawls`,
  `platform-web/components/project-crawl-audit.tsx` и
  `crawl-automation-panel.tsx` — public RBAC/CSRF/audit boundary, dedicated
  Jobs→Platform fresh-execution authorization и private browser
  progress/issues/Radar history/schedule UI;
  UI держит Page Map основным экраном, складывает evidence/настройки в
  компактные disclosure-секции; internal terminal notification controller
  заново проверяет `page.view` и создаёт policy-aware idempotent запись в Realtime;
- `platform-jobs-integrations/src/platform-api` — bounded/no-redirect client
  issuer-а с dedicated token, exact envelope/request/scope hash validation,
  no-store check, response size и timeout limits;
- `platform-jobs-integrations/src/auth-email`,
  `src/auth-email-worker.main.ts` и `src/auth-email-worker.module.ts` —
  отдельный JetStream/SMTP worker без Redis: exact source validation,
  canonical event hash/idempotency, DB lease/state recovery, JIT Platform
  material/completion, localized templates, bounded retry и redacted DLQ;
- `platform-jobs-integrations/prisma/migrations/20260730130000_auth_email_delivery_attempts`
  — Jobs-owned `auth_email_delivery_attempts` без recipient/token/content,
  unique source event identity, bounded attempt/lease/status matrix,
  immutable SMTP receipt/terminal guards и запрет destructive mutation;
- `platform-jobs-integrations/prisma/migrations/20260731060000_npd_receipt_email_delivery`
  — expand-only allowlist durable attempt для
  `billing.npd-receipt.delivery-requested.v1`;
- обе migrations `20260731070000_semantic_capacity_entitlements` —
  immutable plan snapshot в Jobs import и bounded reservation/`ABORTED`
  lifecycle в SEO Data receipt;
- `platform-jobs-integrations/src/rank-worker.main.ts` — изолированный
  rank-preparation entrypoint с per-delivery lease owner, PostgreSQL
  preparation/execution dispatcher recovery, отдельными manifest/grant/result
  tokens, staged-result ingest и terminal finalization;
- `platform-jobs-integrations/src/connector-worker.main.ts` — isolated
  credential-validation, Arsenkin submit/poll и Keys.so competitor-keyword
  runtime в одном
  provider-wide BullMQ limiter; credential material расшифровывается только
  после lease-fenced DB claim; payload очереди содержит только runtime tick;
- `platform-jobs-integrations/src/import-worker.main.ts` — кроме file import
  восстанавливает подтверждённый Keys.so preview через ту же
  `semantic-import` keyspace; SEO Data normalize/begin/chunk/complete receipts
  делают повтор после crash безопасным;
- migrations `20260730123000_rank_connector_result_enum`,
  `20260730123100_rank_connector_provider_runtime`,
  `20260730123200_rank_job_runtime_finalization` и
  `20260730123300_rank_provider_runtime_activation` — durable provider
  lifecycle, least-privilege brokers, mixed terminal counts и новая
  irreversible kill-switch generation;
- `platform-jobs-integrations/src/seo-data` — строго валидируемый internal
  HTTP client владельца semantic core и bounded rank-estimate scope;
- `platform-seo-data/src/semantic-imports` — нормализация, import receipts,
  quota reservation, идемпотентное применение chunks, abort/partial
  finalization и semantic version;
- `platform-seo-data/src/internal/semantic-capacity.ts` — единый exact parser,
  workspace advisory locks и атомарные keyword/tracked-pair counters для
  всех SEO Data writers;
- `platform-seo-data/src/keywords` — tenant-scoped keyword read model и
  manual command owner: trigram search, allowlisted filters, пять stable
  keyset sorts с filter-bound cursor, CRUD с CAS, cluster/group/tag/page relations,
  derived `isTracked` по активным temporal assignments и deterministic
  duplicate-aware keyword cleaner с preview, partial apply и reversible version;
- `platform-seo-data/src/keyword-groups` — bounded tree query, nested create,
  rename/move с cycle guard и descendant path rewrite, CAS и безопасное
  удаление только пустой группы;
- `platform-seo-data/src/clusters` — tenant-scoped manual cluster CRUD,
  active-keyword counters, case-insensitive duplicate guard, CAS и безопасное
  soft-delete только пустого кластера; keyword assignment использует ту же
  project advisory-lock границу; primary Page mapping проверяет active
  tenant/project page под row lock и отдаёт derived missing/cannibalization
  diagnostics; bounded выбор 1–200 кластеров имеет отдельный preview,
  exact-version partition и атомарный partial apply без blind overwrite;
  lock/exclude controls защищают будущую рекластеризацию, а bounded merge
  2–50 кластеров использует preview, exact CAS, единый lock order и один
  смешанный keyword/cluster reversible change set; bounded split из
  выбранных запросов использует тот же lock order, запрещает пустой источник
  и сохраняет полностью обратимую mixed version;
- migration `20260801030000_semantic_cluster_integrity` — fail-closed legacy
  review, partial case-insensitive uniqueness активных cluster names и
  составной tenant/project FK `Keyword.clusterId → Cluster`;
- migration `20260801040000_cluster_primary_page` — nullable primary Page,
  constrained source/confidence/rationale, tenant-safe composite FK и
  page-map lookup index;
- migration `20260801050000_cluster_version_changes` — fail-closed расширение
  semantic change set на `CLUSTER` с предварительной online validation нового
  check constraint;
- migration `20260801060000_cluster_reclustering_controls` — metadata-only
  boolean lock/exclude controls и concurrent eligibility index для будущего
  proposal worker;
- `platform-seo-data/src/semantic-saved-views` и migration
  `20260730170000_semantic_saved_views` — tenant/owner-scoped private и
  project-shared views, partial unique names, strict v1 config DSL,
  optimistic locking и soft delete; browser управляет views через
  same-origin BFF;
- migration `20260730170500_keyword_filter_indexes` — tenant-prefixed btree
  indexes для updated/text/priority/intent keyset filter/sort paths;
- `platform-seo-data/src/semantic-custom-columns` и migration
  `20260730190000_semantic_custom_columns` — definitions двенадцати базовых
  типов, indexed typed EAV values, composite tenant FK, DB type trigger,
  per-cell CAS, option-removal race guard и fail-closed legacy JSON backfill;
- `platform-seo-data/src/semantic-imports` создаёт import-mapped LONG_TEXT
  definitions/values в typed storage, сохраняя legacy JSON только как
  переходную совместимость;
- `platform-seo-data/prisma/migrations/20260730110000_keyword_editor_fields`
  — `keywords.is_favorite`, allowlisted `intent` и active favorite index;
- `platform-seo-data/src/tracking-contexts` — logical context,
  immutable configuration versions, temporal keyword assignments,
  create receipts и transactional redacted outbox events;
- `platform-seo-data/src/rank-scopes` — атомарный bounded snapshot контекста,
  конфигурации и temporal assignments с domain-separated semantic hash без
  передачи keyword IDs/text;
- `platform-seo-data/src/internal` — отдельные `PlatformApiGuard` и
  `JobsApiGuard` для general route groups плюс dedicated rank guards;
- `platform-jobs-integrations/src/email` — email port, disabled и SMTP adapters;
- `platform-realtime/src/realtime` — Socket.IO gateway и namespace-only Redis
  adapter для `/collaboration` с versioned channel prefix
  `seo-platform:realtime:v1`, specific response channels и без Redis
  key/presence access; gateway принимает только одноразовый 256-bit ticket с
  exact browser Origin, сам выводит user/project rooms из trusted snapshot и
  завершает соединение по bounded authorization lease; root namespace
  остаётся in-memory и не создаёт запрещённые Redis subscriptions;
- `platform-realtime/src/realtime-auth` — hash-only project ticket owner:
  атомарная 30-секундная one-time consume, origin binding, session-family
  tombstone, per-user issue/connection limits и 60-секундная authorization
  lease. Platform API повторно проверяет membership/RBAC до выдачи; изменение
  membership уже подключённого клиента не даёт instant disconnect, а
  ограничено сроком lease;
- `platform-realtime/src/notifications` — профильные правила, membership-bound
  проектные подписки, effective policy, user-scoped notification center и
  encrypted browser Web Push device lifecycle, durable per-device attempts,
  isolated delivery worker, retry/expiry и persistent key canaries;
- `platform-realtime/src/web-push-worker.*` — отдельный application context
  без HTTP/NATS/Redis, с VAPID private key, outbound network и narrow
  `realtime_web_push` DB role;
- `platform-realtime/src/messaging` — exact durable JetStream pull consumer
  terminal session-family event: commit-before-ack, bounded retry/jitter,
  redacted DLQ, topology readiness и bounded shutdown;
- `platform-realtime/src/common/request-id.ts` — bounded correlation ID для
  сквозной Platform API → Realtime трассировки с UUID fallback;
- `platform-realtime/src/internal` — `PlatformApiGuard` general HTTP audience,
  отдельный Web Push guard и проверенный actor/tenant/membership context;
- `platform-web/app` — public, tools, docs и private `/app` App Router screens;
- `platform-web/lib/http-security-policy.ts` + `next.config.ts` — общие
  nosniff/frame/referrer/permissions headers без изменения public marketing
  cache, production HSTS и отдельные private/no-store/noindex rules для
  `/app`; CSP пока ограничен безопасным `frame-ancestors 'none'` без
  непроверенных script/style directives;
- `platform-web/app/app/api` — same-origin browser BFF только к
  `/api/v1` Platform API;
- `platform-web/app/app/(protected)/settings/workspace` и
  `projects/[projectId]/settings/general`, `components/*-settings.tsx`,
  `lib/tenant-settings.ts` — private/noindex workspace/project settings с
  role/read-only guards, `If-Match`, draft-preserving `412` recovery,
  explicit duplicate-domain retry и exact-name archive/restore confirmation;
- `platform-web/app/app/(protected)/settings/team`,
  `components/team-management.tsx`, `lib/team-management.ts` — private/noindex
  bounded team/invite lists, owner/admin mutations с `If-Match`, явный
  all-projects либо searchable project-level access editor и полные
  loading/empty/error/offline/degraded/permission states;
- `platform-web/components/browser-push-settings.tsx`,
  `lib/browser-push.ts`, `lib/push-installation.ts`,
  `lib/push-registration-reconciliation.ts` и
  `public/push-service-worker.js` — явный permission/registration flow,
  IndexedDB installation UUID/schema v2 generation-CAS, causal reconciliation,
  device list/rename/revoke/reconcile, явное recovery повреждённой/future
  local record и Service Worker со scope `/app/` без fetch cache;
- `platform-web/lib/one-time-link.ts`, verification/password recovery forms и
  `app/app/workspace-invites/accept` — строгий single-token fragment parser,
  немедленное удаление fragment из history и same-origin acceptance flow;
- `platform-web/app/app/(protected)/projects/[projectId]/rankings/contexts` —
  private/noindex экран контекстов позиций; UI-компоненты находятся в
  `platform-web/components/tracking-context-*`, provider-free estimate —
  в `rank-estimate-panel.tsx`;
- `platform-web/app/app/(protected)/projects/[projectId]/rankings`,
  `components/rank-history.tsx`, `components/rankings-tabs.tsx` и
  `lib/rank-history.ts` — private/noindex история позиций с UTC range,
  context/keyword filters, cursor-дозагрузкой и явными archived/read-only
  состояниями;
- `platform-web/app/app/(protected)/projects/[projectId]/rankings/automations`,
  `components/rank-automations.tsx` и `lib/rank-automations.ts` —
  private/noindex редактор daily/weekly расписаний, тарифный счётчик,
  pause/resume, ручной запуск и bounded история с полными loading/empty/error/
  offline/permission состояниями;
- Web image получает обязательный `WEB_PUBLIC_URL` как
  `NEXT_PUBLIC_SITE_URL` до `next build`, чтобы canonical metadata, robots и
  sitemap не зависели от запоздалого runtime env;
- browser BFF использует тот же валидированный `NEXT_PUBLIC_SITE_URL` как
  trusted exact origin: deployment за reverse proxy не сравнивает внешний
  browser Origin с внутренним `next start` URL, а отсутствующая конфигурация
  сохраняет безопасный local fallback. Неканоничный URL, path, credentials,
  query или fragment дают fail-closed `403` до Platform API;
- Platform API, SEO Data, Jobs HTTP и Realtime принимают только явный `BIND_ADDRESS` из
  `127.0.0.1|0.0.0.0`: local development по умолчанию остаётся на loopback,
  а Compose явно выбирает `0.0.0.0` только внутри изолированной container
  network. Realtime development origin совпадает с Web на
  `http://localhost:3000`;
- `platform-admin` подключён к `internal + edge` без host port и принимает
  отдельный exact `ADMIN_PUBLIC_URL`. Browser видит только same-origin BFF с
  явным route allowlist; общая session identity допускается лишь после MFA,
  recent authentication и active platform role. Панель полностью
  server-backed, private/no-store/noindex; каждый просмотр billing PII и
  mutation фиксируется в audit;
- `platform-web/lib/protected-app.ts` — server-side session gate и безопасный
  refresh redirect;
- `platform-*/lib` и `components` — adapters и переиспользуемые UI-части;
- `platform-infrastructure/docker` — reusable backend/web images;
- `platform-infrastructure/nats/nats-server.conf` — bounded JetStream store и
  exact deny-by-default ACL для generic runtime, Platform API publisher,
  Realtime consumer, Jobs auth-email consumer и topology provisioner;
  `start-nats.sh` fail-closed
  валидирует canonical `$2a$` cost-11 verifier, подставляет exact markers в
  приватный mode-600 config внутри runtime tmpfs, удаляет credential env перед
  `exec` и не допускает повторного `$`-разыменования broker config;
- `platform-infrastructure/nats/provisioner.mjs` + `topology.mjs` — one-shot
  non-root/read-only provisioner exact `IDENTITY_EVENTS`,
  `AUTH_EMAIL_EVENTS`, shared `DOMAIN_EVENTS_DLQ`,
  `realtime_session_family_revoked_v1` и `jobs_auth_email_v1`; создаёт
  отсутствующие ресурсы, безопасно reconciles только allowlisted limits и
  fail-closed останавливается при identity/subject/transform drift;
- `platform-infrastructure/redis` — pinned Redis 8 configs, secret-safe
  atomic ACL renderer и startup wrapper для отдельных Jobs, Realtime и
  Directus instances; config и ACL перед privilege drop копируются в
  owner-correct runtime tmpfs. Jobs хранит AOF volume с отдельным rewrite
  memory headroom, остальные два используют bounded ephemeral tmpfs;
- `platform-infrastructure/compose.dokploy.yml` — отдельный internal-only
  `rank-worker` process того же Jobs image с exact env allowlist, bounded
  resources, migration/Redis/SEO Data/Platform API dependencies, двумя
  dedicated rank tokens, отдельным `jobs_rank_runtime`, forced-disabled
  provider submit и без ports/outbound;
- тот же Compose запускает bounded `crawl-worker` с отдельным Redis user,
  Jobs DB/SEO Data/outbound-only capability set, contact User-Agent,
  PostgreSQL lease recovery и без NATS/S3/SMTP/vault/rank/provider secrets;
- тот же Compose запускает `auth-email-worker` отдельным process того же Jobs
  image с `jobs_auth_email_runtime`, dedicated NATS identity и Platform token,
  SMTP-only outbound capability, bounded resources/timeouts и без Redis/
  general/vault/rank/S3 secrets; container-local readiness marker появляется
  после bootstrap и удаляется до drain, а `stop_grace_period` строго больше
  worst-case `AUTH_EMAIL_SHUTDOWN_GRACE_MS` budget;
- тот же Compose разделяет Jobs HTTP, Redis-only system, import и inspection
  env allowlists и подключает каждый процесс только к его named Redis user и
  isolated network; static regression проверяет exact recipients четырёх
  caller/audience, dedicated service tokens и девяти Redis credentials и
  запрещает legacy env;
- `platform-infrastructure/security/validate-service-tokens.sh` — one-shot
  fail-closed deploy preflight для глобальной проверки 27 credentials и
  пяти отдельных NATS bcrypt verifier/usernames; credential-bearing
  processes и NATS зависят от его успешного завершения;
- тот же Compose fail-closed требует `JOBS_TO_SEO_RANK_RESULT_TOKEN` и
  `RANK_HISTORY_CURSOR_KEY` только для `seo-data`; regression test запрещает
  их случайную выдачу остальным runtime processes;
- `platform-infrastructure/postgres/init` — создание service databases;
- `platform-infrastructure/postgres/roles` — fail-closed cluster bootstrap
  canonical `platform/seo/jobs/realtime` migration-owner/general runtime
  roles и scoped `jobs_rank_runtime`/`jobs_auth_email_runtime`, SCRAM password provisioning через
  stdin, безопасная передача только пустых legacy databases и cluster-wide
  ownership/membership/ACL audit;
- `platform-infrastructure/postgres/config/start-postgres.sh` — generated
  first-match HBA для всех canonical owner/runtime, Directus и connector
  logins: SCRAM разрешён только в exact собственной database, replication,
  соседние databases и stale family names отклоняются до общих local/host
  rules;
- `platform-infrastructure/postgres/permissions` — идемпотентные fail-closed
  post-migration grants. `service-runtime.sql` проверяет canonical database/
  schema/object owner, запрещает runtime membership/ownership, полностью
  закрывает private provider intents от `jobs_runtime` и выдаёт rank-role
  exact table/verb/column allowlist без vault ciphertext, sequences/default
  privileges; auth-email role получает только `SELECT/INSERT/UPDATE`
  `auth_email_delivery_attempts`, а general Jobs role этой таблицы не видит;
  RLS оставляет только manual rank/validation и
  `SERP_RANK_TRACKING` graph. General роли получают CRUD без
  `_prisma_migrations`/`TRUNCATE`, sequence use и точные routines;
  default ACL сохраняют правило для будущих объектов. Отдельный audited
  `seo-extension-runtime.sql` закрывает `PUBLIC` у member functions exact
  `pg_trgm` и открывает их только `seo_runtime`. Connector DDL создаёт/
  ужесточает `jobs_connector`, отклоняет обе стороны membership edge,
  cluster ownership/чужой ACL и выдаёт только exact `EXECUTE` allowlist
  credential-validation broker, rank claim и pre-network authorize. Directus
  имеет документированное combined owner/runtime исключение
  `directus_runtime_owner` только для `directus_db`. Target environment всё
  равно требует проверки фактического HBA order/login smoke, а непустой legacy
  volume — reviewed object-by-object ownership handoff.

Entrypoints:

- API/SEO/realtime/jobs HTTP: `src/main.ts`;
- system worker: `platform-jobs-integrations/src/worker.main.ts`;
- upload inspection worker:
  `platform-jobs-integrations/src/inspection-worker.main.ts`;
- semantic import worker:
  `platform-jobs-integrations/src/import-worker.main.ts`;
- rank manifest preparation worker:
  `platform-jobs-integrations/src/rank-worker.main.ts`;
- technical crawl worker:
  `platform-jobs-integrations/src/crawl-worker.main.ts`;
- credential validation connector worker:
  `platform-jobs-integrations/src/connector-worker.main.ts`;
- transactional auth-email worker:
  `platform-jobs-integrations/src/auth-email-worker.main.ts`;
- connector DB permission init:
  `platform-infrastructure/postgres/permissions/provision-jobs-connector-role.sh`
  + `jobs-connector.sql`, one-shot Compose service
  `jobs-connector-db-permissions`;
- service DB role bootstrap и runtime permission init:
  `platform-infrastructure/postgres/roles/provision-service-database-roles.sh`
  + `platform-infrastructure/postgres/permissions/provision-service-runtime-role.sh`,
  one-shot Compose services `service-database-roles` и
  `*-runtime-db-permissions`;
- NATS topology init: `platform-infrastructure/nats/provisioner.mjs`, one-shot
  Compose service `nats-topology-provisioner`; Platform API, Realtime и
  auth-email worker ждут его `service_completed_successfully`;
- Redis ACL init: `platform-infrastructure/redis/start-redis.sh` вызывает
  `render-acl.sh` до `redis-server`, удаляет plaintext secrets из child
  environment, копирует config и атомарно передаёт hashed ACL через
  `redis:redis` runtime tmpfs;
- Next.js: App Router соответствующего frontend-пакета;
- remote stack: `platform-infrastructure/compose.dokploy.yml`.

## 7. Статус модулей

Легенда: `planned` → `foundation` → `vertical slice` → `production-ready`.

| Модуль | Статус |
|---|---|
| Contracts | foundation |
| Service health/readiness | foundation |
| Prisma schemas | foundation |
| NATS/Redis wiring | vertical slice: durable terminal identity + transactional auth-email NATS pipelines и isolated versioned Redis ACL topology; source-built Redis 8.8.1 live smoke пройден, target Docker image остаётся gate |
| S3/email ports | vertical slice: S3 foundation + выделенный auth-email SMTP worker; общий notification sender не реализован, production SMTP остаётся operator gate |
| Realtime public gateway | foundation |
| Unified Web/private app shell | vertical slice |
| Admin operations | vertical slice: MFA + persisted roles + NPD operations |
| Auth core | vertical slice: identity lifecycle + transactional verification/reset email transport |
| Workspaces/projects/team access | vertical slice: включая transactional invite email/fragment acceptance |
| Semantics/import | vertical slice: Key Collector-style groups/manual clusters/table/tools + CSV/TSV/XLSX → mapping → validation → quota reservation → publish/abort → query; manual cluster→primary Page, derived missing/cannibalization diagnostics, lock/exclude, bounded cluster merge/split и keyword cleaner с preview/history/undo закрыты; background merge/split, full SERP-based auto-clustering proposals, alternate pages и расширенное SERP evidence ещё не закрыты |
| Notifications | vertical slice: preferences → effective policy → read center → encrypted browser device lifecycle + durable terminal crawl in-app notifications |
| Integrations | vertical slice: operational catalog + encrypted BYOK vault + validation + SERP/competitor project bindings |
| Rankings | vertical slice: contexts + estimate/preparation + persisted/public history + реальный Arsenkin submit/poll/normalize/finalize; live BYOK canary остаётся gate |
| Automations | vertical slice: rank schedule CRUD + тарифный capacity + BullMQ scheduler + manual/scheduled execution + no-overlap/recovery/history/auto-pause + Web |
| Pages/technical audit | vertical slice: compact Page Map с command bar, 4 смысловыми колонками и progressive editor + CRUD/assignment + SSRF-safe async crawl + sitemap/include/exclude/query scope + conditional 304 reuse/global host backoff/24h site auto-pause + immutable snapshots/current issues/page-change/duplicate/exact-scope disappearance history + lease/checkpoint recovery + единая tab-панель проблем/запусков/дублей/исчезновений/Radar + компактное расписание Radar + in-app notification |
| Billing/YooKassa | vertical slice: catalog + hosted/recurring payment + webhook/reconciliation + ledger/refund/NPD obligation + Web UI + protected manual receipt operations + durable receipt email delivery; live provider/SMTP canary остаётся gate |
| Directus content | planned |

Foundation содержит четыре валидные Prisma schemas и начальные migrations,
health/readiness, Redis/BullMQ, NATS transport, S3/SMTP adapters, fail-closed
WebSocket gateway, unified web/admin shell и Dokploy Compose.

Identity core содержит регистрацию email/password, consent snapshots,
Argon2id, email verification, одноразовое password recovery с отзывом прежних
сессий, TOTP/recovery codes с зашифрованными secrets и короткоживущим login
challenge, короткую access cookie, rotation refresh cookie, CSRF, session
inventory/revocation, PostgreSQL rate limit, audit и outbox. По ADR-2026-036
terminal revoke сериализуется advisory lock по user, меняет distinct whole
families и пишет exact redacted `identity.session-family.revoked.v1`.
Bounded global expiry sweeper выбирает просроченные active families малыми
batches, повторно проверяет due state под тем же lock и вызывает общий
revoke/outbox helper; production config требует sweeper включённым. Для
`IDENTITY_EVENTS` Platform API publisher обрабатывает только этот exact event
type, подтверждает exact stream PubAck и хранит bounded retry/terminal failure
в outbox.
Password reset дополнительно инвалидирует outstanding login MFA challenges;
session issue повторно проверяет ожидаемую версию active user под lock.
MFA setup/activation/disable и revoke-others повторно валидируют exact
active/unexpired principal session под тем же lock. Refresh rotation наследует
исходные family `authenticatedAt`/`expiresAt`, а migration консервативно
исправляет legacy rows. Session inventory имеет bounded encrypted user-bound
keyset cursor без раскрытия family ID. Новые family IDs — UUIDv7; legacy UUIDv4
продолжают читаться без смены identifier.

Регистрация/resend verification, password reset request, workspace invite и
ручная регистрация NPD receipt атомарно создают secret-free transactional
outbox events. Publisher валидирует
их отдельно от terminal identity event и отправляет в `AUTH_EMAIL_EVENTS`.
Jobs durable attempt дедуплицируется по source event ID/hash; JIT material
повторно проверяет authoritative Platform state непосредственно перед SMTP.
Устаревший token/invite даёт `SKIPPED/NOT_DELIVERABLE`, а успешный invite
completion переводит только актуальный `SENT` в `DELIVERED`; hard recipient
rejection после redacted DLQ PubAck переводит только актуальный `SENT` в
`BOUNCED`, а NPD receipt — из `DELIVERY_PENDING` в `FAILED_FINAL`.
Успешная отправка NPD receipt фиксирует `DELIVERED` и `deliveredAt`; recipient,
официальный URL и текст чека не сохраняются в Jobs DB/NATS. SMTP и Jobs DB не
транзакционны: crash после SMTP accept и до durable receipt может вызвать
повтор со стабильным `Message-ID`, поэтому exactly-once не заявляется.

Tenant core содержит workspace/project CRUD, системную RBAC-матрицу,
одноразовые workspace invitations, optimistic locking участников и
`project_member_access`. Проектное назначение только сужает workspace role;
`NONE` и отсутствие назначения при `all_projects=false` скрывают проект.

Private Web содержит same-origin BFF, регистрацию/вход/подтверждение email,
запрос и установку нового пароля, refresh/logout, session gate, создание и
выбор workspace/project, MFA challenge и экран безопасности профиля с полным
пагинируемым списком active sessions/revoke. BFF передаёт Platform API только
один canonical IPv4/IPv6 от ближайшего proxy и fail-closed отклоняет chain,
malformed и zone-id значения. Verification/password/invite links принимают
token только во fragment, немедленно очищают browser history и передают его
Platform API только через same-origin BFF; invite acceptance доступен по
`/app/workspace-invites/accept`. Для Realtime ticket BFF передаёт browser
`Origin` только при exact canonical совпадении с текущим Web origin и
отклоняет cross-origin запрос до Platform API. Workspace/project settings
редактируют только
разрешённые поля через OCC, показывают read-only/suspended/archived состояния
и сохраняют данные при archive/restore; delete flow намеренно отсутствует. До
появления SEO-данных dashboard показывает empty states, а не демонстрационные
значения.

Первый import slice содержит публичные project upload endpoints, внутренний
multipart lifecycle в jobs database, прямую browser → S3 загрузку частей,
resume через `sessionStorage`, retry/cancel, обязательную проверку полного
набора частей и фактического размера. `upload.completed.v1` означает только
статус `UPLOADED`; использовать объект для импорта можно лишь после inspection
worker и статуса `READY`.

Inspection worker читает S3 строго потоком, удерживает восстанавливаемый
lease/heartbeat, считает фактический SHA-256 и размер, проверяет сигнатуру
контейнера/MIME и передаёт весь поток в ClamAV. Scanner работает fail-closed:
его недоступность возвращает запись в `UPLOADED` для retry, а не разрешает
импорт. Итог фиксируется событиями `upload.ready.v1` или
`upload.rejected.v1`; rejected-объект не получает download/import access.
Web после multipart completion опрашивает project-scoped status endpoint,
показывает scanning/ready/rejected и позволяет отдельно обновить долгую
проверку, не создавая повторную загрузку.

Второй import slice создаёт import только из `READY` upload, повторяет команду
по `Idempotency-Key` и ставит в отдельную BullMQ queue только `importId`.
Import worker потоково определяет UTF-8/Windows-1251 и разделитель, корректно
обрабатывает quoted/multiline CSV/TSV, восстанавливает зависший lease,
сохраняет исходные значения в 16 hash partitions и предлагает mapping
типовых колонок Key Collector. Jobs API не возвращает raw staging наружу.
Web автоматически запускает CSV/TSV parsing после inspection, показывает
progress и ограниченный preview колонок/строк. Публикация в канонический
semantic core выполняется только после отдельного подтверждения пользователя.

Третий import slice сохраняет подтверждённые язык, separator групп, mapping и
merge policy, затем создаёт отдельный validated staging. Нормализация и поиск
существующих запросов выполняются владельцем `seo_db`; неизвестные показатели,
позиции без tracking context и исходные raw values не теряются. UI показывает
summary дублей, ошибок и готовых уникальных запросов до необратимой публикации.

Publisher передаёт не более 500 уникальных строк на command, повторно
валидируемую `seo-data`. Receipt с mapping/payload hash делает begin/chunk/
complete идемпотентными; workspace capacity lock и project write lock
сериализуют quota reservation/merge, а complete создаёт semantic version,
освобождает неиспользованный резерв и пишет outbox event. Отмена во время
публикации завершает текущий chunk и фиксирует partial version; отмена до
первого chunk помечает receipt `ABORTED` и не оставляет capacity leak.
Зависший `cancel_requested` подбирается dispatcher-ом. Jobs не имеет
подключения к `seo_db`.

Опубликованное ядро читается по `GET /api/v1/projects/:projectId/keywords`.
Platform API проверяет session, `semantic.view` и tenant scope, затем вызывает
internal query `seo-data`; Web использует только same-origin BFF. Список
применяет keyset cursor по `created_at DESC, id DESC`, до 200 строк, связанный
с поиском opaque cursor и GIN/trigram индекс. Exact count выполняется только
на первой странице. UI содержит поиск, дозагрузку, loading/empty/error states
и автоматически обновляется после полной или частичной публикации версии.

Настройки уведомлений читаются и изменяются только через Platform API:
`/api/v1/me/notification-preferences` и
`/api/v1/projects/:projectId/notification-subscription`. Профиль задаёт
master-switch каналов, timezone, quiet hours, digest schedule и матрицу
категорий. Проект может наследовать профиль, переопределить только разрешённые
каналы либо временно поставить доставку на паузу. Подписка привязана к
`workspace_members.id + version`; отзыв или новая версия членства не
активирует старые правила. Web Push permission запрашивается только явной
кнопкой.

Browser devices читаются и изменяются через
`GET/PUT/PATCH/DELETE /api/v1/me/push-subscriptions`; публичный body не задаёт
actor/session/status. Platform API инжектирует проверенную session family и
использует отдельный `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`.
Installation UUID хранится Web в IndexedDB. Realtime принимает только exact
HTTPS endpoint origins, шифрует endpoint/keys через versioned AES-256-GCM,
использует независимый HMAC keyring для fingerprints, ограничивает active
devices (default 20), возвращает active devices перед bounded tombstone
history, очищает due subscriptions до list/upsert и стирает secret material
при terminal revoke/expiry. Межсервисный request ID принимается только в
bounded safe ASCII-формате, иначе заменяется локальным UUID. Partial unique
index защищает один HMAC digest; межверсионная endpoint uniqueness требует
all-keyring lookup и rollout `expand на всех replicas → drain → switch`.
VAPID public key имеет immutable version; private key не поступает в HTTP/Web
process. Service Worker работает в scope `/app/`, не содержит fetch handler и
не кэширует private API. Локальная schema v2 хранит
`reconcileGeneration/reconciledGeneration`: Service Worker и вкладки
атомарно повышают generation, а успешный PUT очищает marker только для exact
generation и только если отправленная subscription всё ещё совпадает с
browser state. Запоздалый PUT после локальной смены subscription повторно
взводит marker. Повреждённая или future local record восстанавливается лишь
после явного подтверждения, успешного browser unsubscribe и выдачи нового
installation UUID; перенос между аккаунтами запрещён. Registration возвращает
`deliveryAvailable` только из явного HTTP rollout flag; preview оставляет его
`false`. `testDeliveryAvailable=false` до отдельной test command. При
включённом Web Push effective policy атомарно создаёт exact device attempts;
isolated sender повторно проверяет authoritative membership/project access до
decrypt и применяет bounded retry/expiry. Общий email/digest и delivery
history UI пока отсутствуют; ADR-2026-038 transactional auth-email не
использует notification profile/project policy.

Handler `identity.session-family.revoked.v1` атомарно
сохраняет versioned inbox scope, durable tombstone и отзывает только active
devices той же `userId + sessionFamilyId`, уничтожая crypto/fingerprint
material. Второй event ID той же family идемпотентен, а reuse event ID для
другого scope отклоняется. Device upsert проверяет tombstone сразу после
общего user lock и до endpoint lock либо mutation; Platform API сохраняет
terminal `401 UNAUTHENTICATED`, не маскируя его как сбой зависимости. DDL
добавляет индекс `user + registered session family + status`. Durable pull
consumer доставляет exact envelope в handler, ack-ит source только после
локального commit, делает bounded retry/NAK и после исчерпания попыток либо
для permanent invalid message публикует redacted DLQ envelope. Readiness
проверяет source/DLQ streams и durable consumer; runtime topology не меняет.

Центр уведомлений доступен по `/app/notifications`; колокольчик получает
user-scoped unread count, а список использует keyset cursor
`created_at DESC, id DESC`, связанный с фильтром `unreadOnly`. Публичные
`GET /api/v1/notifications`, `PATCH /:id/read` и `POST /read-all` проходят
только через Platform API. Realtime DB хранит явные event type, severity,
project/resource references и только локальный `/app` deep link; произвольный
JSON наружу не возвращается. Mark-read команды идемпотентны и ограничены
текущим пользователем.
Terminal complete/partial/failed crawl атомарно пишет redacted outbox intent.
Jobs dispatcher повторяет доставку, Platform API заново проверяет membership,
проект и `page.view` инициатора, а Realtime применяет effective
profile/project policy, `notifyOwnJobs` и unique `userId + dedupeKey`.
Результат виден в центре уведомлений как локальный переход к Page Map.
Если пользователь включил Web Push и оператор активировал sender profile, та
же effective policy создаёт idempotent per-device attempt с quiet-hour/digest
schedule. Отзыв membership после fanout отменяет attempt до decrypt через
fresh Platform authorization.

Workspace API-ключи управляются через `/app/settings/integrations`. Platform
API проверяет workspace permission и передаёт trusted actor/workspace context
в jobs/integrations. Секрет и XMLStock user ID шифруются одним authenticated
payload под случайным per-record DEK; versioned KEK шифрует DEK. AAD связывает
payload с workspace/provider/credential ID, а обёрнутый DEK — ещё и с KEK
version. Секрет не возвращается после сохранения и не попадает в
audit/queue/event. Карточки честно показывают `PENDING_VERIFICATION`:
credential нельзя использовать до реального provider-specific test.
Пользовательский base URL не поддерживается. Create требует
`Idempotency-Key`: workspace-wide unique key и keyed fingerprint дают
существующий credential для точного повтора и conflict для другого
actor/payload. Fingerprint version не связан с KEK version, поэтому lifecycle
идемпотентности не блокирует будущий DEK rewrap. UUID канонизируются до
lowercase до AAD/fingerprint и не меняются после PostgreSQL round-trip.

`POST .../credentials/{id}/validations` требует `integration.test`, recent
authentication, CSRF и `Idempotency-Key`; `GET .../validations/{validationId}`
требует `integration.view` и остаётся доступным в billing read-only режиме.
Credential list присоединяет только одну active validation текущего
`material_version`; partial unique делает batch bounded. Поэтому после
reload/navigation другой участник видит текущую job, а Web продолжает GET
polling без повторного POST. Если job появилась между list и POST, `409`
обрабатывается повторным чтением authoritative list и присоединением к ней;
terminal history в credential list не загружается.
Receipt точного повтора ищется до чтения изменяемого credential state:
rotate/disable/revoke не меняют результат уже принятой job-команды, а
`material_version` остаётся execution snapshot и active dedup boundary.
PostgreSQL является источником истины для статусов, attempt, lease и
`retryAt`; dispatcher восстанавливает потерянные сообщения BullMQ, а его
lease/retry indexes начинаются с `job.type`. В очередь не попадает секрет.
Execution worker расшифровывает его только в памяти и вызывает фиксированные
HTTPS endpoints Arsenkin или Keys.so с timeout, запретом redirect, строгим
JSON для `2xx`, body limit 1 MiB и нормализацией ошибок.
Успешная provider validation заменяет сохранённый capability snapshot
текущим allowlist каталога: удалённая capability исчезает сразу через
пересечение, а новая не выдаётся старому ключу без повторной внешней проверки.
Terminal update атомарно сверяет workspace и `material_version`: замена или
revoke credential делает старую проверку `STALE`, не перезаписывая новый
материал. Retry учитывает ограниченный `Retry-After`. XMLStock теперь входит
в operational catalog: credential validation использует документированный
read-only `regionsTree` Wordstat endpoint, нормализует JSON error codes даже
при HTTP 200 и не пишет query URL с user/key в логи. Arsenkin рекламирует
только рабочий съём позиций, Keys.so — keyword/competitor research.
Partial unique active dedup key ограничивает один validation на пару
credential/material даже при разных `Idempotency-Key`.

Проектные источники настраиваются через
`/app/projects/:projectId/settings/integrations` для `SERP_RANK_TRACKING`,
а `COMPETITOR_RESEARCH` назначается прямо в рабочем экране конкурентов.
Оба сценария используют общий capability-based contract. На пару
`workspace + project + capability` существует одна
привязка и один нормализованный route `WORKSPACE_CREDENTIAL` с `position=0`.
Создание разрешает только non-deleted `ACTIVE BYOK_API_KEY`, принадлежащий
workspace и поддерживающий capability одновременно в сохранённом credential и
текущем provider catalog. Отключить уже сломанную привязку можно без активного
ключа; включение и смена route повторяют строгую проверку.

POST требует `Idempotency-Key`: binding, route, immutable create receipt с
32-byte request hash/исходным response snapshot и redacted outbox event
создаются одной транзакцией. Поэтому replay после PATCH возвращает исходный
ответ создания. PATCH требует `If-Match`, использует CAS и при гонке отвечает
`412 VERSION_CONFLICT` с безопасным `currentVersion`. Billing `READ_ONLY` и
архивный проект сохраняют просмотр, но не разрешают новые изменения; проекты
и bindings автоматически не удаляются. Platform keys, fallback и budgets
пока возвращают `FEATURE_NOT_AVAILABLE`, а credential options не содержат
секрет, masked hint или provider metadata.
Aggregate читается одним `RepeatableRead` snapshot и возвращает не более 500
options; при большем vault выставляет `credentialOptionsTruncated`, сохраняя
в выдаче credentials уже назначенных bindings. Create/enable/swap держат
tenant-scoped `FOR SHARE` lock credential до commit, поэтому rotate/revoke не
может пройти между проверкой и записью binding. Outbox payload типизирован в
`platform-contracts`, не содержит credential ID и передаёт безопасный
`changedFields`, включая смену route между двумя ключами одного provider.

Контексты позиций настраиваются на
`/app/projects/:projectId/rankings/contexts`. Public API
`/api/v1/projects/:projectId/tracking-contexts` поддерживает list/create/get/
update/archive/restore и point PUT/DELETE assignments; внутренний mirror
принадлежит SEO Data. Read требует `ranking.view`, mutation —
`ranking.configure`, CSRF и mutable project/workspace. Create использует
immutable idempotency receipt, update/archive/restore — `If-Match`; billing
read-only и архивный проект не скрывают чтение. Списки bounded: 200 contexts
с `contextsTruncated`, assignments — keyset cursor с limit до 200.

`seo_db` migration `20260729130000_versioned_tracking_contexts` добавила
`tracking_context_versions`, `tracking_context_keyword_assignments` и
`tracking_context_create_receipts`, а `tracking_contexts` оставила logical
entity с OCC/archive state. Поисковые изменения создают immutable
configuration version; rename/archive/restore её не переписывают. Assignment
закрывается `removed_at`, повторное назначение создаёт новый период,
`keywords.is_tracked` больше не источник истины. Migration блокирует legacy
tracking/rank tables `ACCESS EXCLUSIVE` и fail-closed останавливается при
наличии данных.

Contracts содержат HTTP DTO и события
`seo.tracking-context.created/updated/archived/restored.v1` и
`seo.tracking-context.keyword-assignment.changed.v1`. SEO Data пишет их в
outbox атомарно и без name, keyword text, URL, provider/credential/schedule и
raw configuration. Durable outbox publisher всё ещё не реализован, поэтому
эти SEO Data записи ещё не доставляются через NATS; identity publisher
Platform API их намеренно не выбирает.

Provider-free estimate доступен через
`POST /api/v1/projects/:projectId/rank-estimates` с телом только
`trackingContextId`. Platform API требует session, CSRF, `ranking.view` и
`Idempotency-Key`, но намеренно не требует `ACTIVE` lifecycle для успешного
ответа: read-only, архив, отсутствие `ranking.run`, entitlement/quota и
состояние connector возвращаются finite blockers. Jobs-owned internal
resource использует
dedicated caller token, stable-intent request hash и immutable public/private
snapshot. SEO Data возвращает exact count до 1 000 либо sentinel `1001`,
а для provider-incompatible bounded scope 1..1 000 либо overflow `1001`
возвращает согласованные unavailable semantic/final hashes. Пустой scope
всегда materializable. TTL receipt — пять минут;
replay после drift project/access/quota возвращает исходный ответ.
Поддержанный Arsenkin profile возвращает `READY`; несовместимый provider
profile, credential/binding или lifecycle остаётся fail-closed с конечным
blocker code до provider call.

Secret-bearing rank manifest endpoints принадлежат SEO Data и защищены
отдельным `JOBS_TO_SEO_RANK_TOKEN`; general caller/audience tokens не дают
читать keyword text chunks. Secret получает только SEO Data validator и
отдельный rank-worker Jobs; generic HTTP, connector/import/inspection/system
workers secret не получают. Rank worker дополнительно использует отдельный
`jobs_rank_runtime`; generic `jobs_runtime` не может читать private intent
table. Клиент запрещает HTTP redirects, ограничивает размер ответа и принимает
только exact tenant-bound receipt.

Execution contract foundation принимает в public create только `estimateId`
и возвращает Job через конечную discriminated lifecycle матрицу. SEO Data
manifest runtime уже реализует dedicated-auth seal/chunk endpoints,
`RepeatableRead` snapshot, byte-first limits, immutable
`BUILDING → SEALED → CLOSED`, provenance checks и partial unique active
semantic dedup. Shared allowlist preimage builders и golden vectors
синхронизируют producer/verifier; full hash включает `sealedBy`, semantic hash
не меняется от clone/rename tracking context, display label, metadata или
remove/reassign, если provider-effective work остаётся тем же. Interactive
manifest transaction использует явные `maxWait=5s` и `timeout=30s`.

Jobs `PREPARING`/JobItem preparation runtime и cancellation finalize
реализованы. PostgreSQL хранит exact command до HTTP, BullMQ получает только
`jobId`, bounded producer не удерживает HTTP при недоступном Redis, а
dispatcher восстанавливает потерянные notifications. Перед HTTP exact
command сверяется с immutable Job/Run/Estimate graph. DB triggers защищают
initial state, monotonic version/attempt, receipts, cancel audit и committed
Job/Run/Estimate coherence. Create вставляет Job, затем sidecar; все мутации
существующего graph блокируют `Job → RankJobRun`. Единственный разрешённый
version drift принимает cancel между seal request/response. Заведомо не
созданный manifest становится `NOT_SEALED`; retryable transport ambiguity
повторяет exact idempotent command в пределах 20 attempts, а non-retryable
неоднозначность либо исчерпание budget дают terminal
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`.

Normalized chunk ingest, append-only snapshots, monotonic current projection,
успешный/partial finalize и atomic redacted completion outbox реализованы в
SEO Data с одним manifest lock и запретом late ingest. Internal history
использует tenant/filter-bound HMAC cursor. Public Platform API строго
валидирует scope, диапазон, фильтры, порядок, дубликаты и cursor coherence,
redact-ит ответ SEO Data и отдаёт collection envelope. Private/noindex Web
экран использует bounded UTC range, optional context/keyword filters и
load-more. Platform API execution-grant issuer использует controlled-beta
authoritative quota: максимум 200 provider tasks на workspace/UTC day с
immutable reservation и exact receipt binding. Jobs bounded client и durable
grant intent/decision history реализованы: network intent
записывается первым, exact replay сохраняется, а неистёкшее положительное
решение атомарно связывается с secret-free scoped connector execution и
становится `CONSUMED`. PostgreSQL dispatcher переводит sealed Job в
`RUNNING/WAITING_EXECUTION_GRANT`, выдаёт grants по всем chunks и
идемпотентно восстанавливается после restart. До grant immutable adapter
request строится только из
verified sealed command/chunk, сохраняется один раз без credential material и
через evidence v2/FK связывается с execution по request/manifest/chunk hashes.
SECURITY DEFINER claim, scoped encrypted credential
projection и exact connector permissions реализованы; `CLAIMED` остаётся
pre-network. Authorize повторно проверяет весь current graph и атомарно
фиксирует `SUBMITTING`/single-attempt marker до secret-free permit.
Connector-worker записывает exact wire/task/poll state и normalized staged
output, а rank-worker проверяет ingest receipt и terminal закрывает
Job/manifest. Raw provider body нигде durable не сохраняется.

Автоматизации съёма доступны на
`/app/projects/:projectId/rankings/automations`. Public API реализует
collection CRUD, `GET/POST .../{automationId}/runs`, pause и resume. Daily и
weekly cron переводятся BullMQ Job Scheduler с IANA timezone; scheduler ID
стабилен от automation ID, а payload содержит только ID и version.
Definition и каждый run сохраняют exact redacted execution snapshot, поэтому
поздняя доставка не читает browser context. Create и manual run идемпотентны,
mutations требуют OCC, включённые schedules сериализуются общим
billing-capacity lock. Advisory lock одного automation дедуплицирует delivery
и создаёт `SKIPPED/OVERLAPPING_RUN`, если предыдущий run ещё активен.
Estimate и rank Job используют stable run-derived keys; restart
reconciliation повторяет только идемпотентный pre-dispatch и settle-ит
terminal Job. После заданного числа последовательных ошибок scheduler
удаляется и automation переходит на `FAILURE_THRESHOLD` pause. Run связан
с automation, estimate и Job составными tenant/project FK; PostgreSQL
проверяет lifecycle, provenance, idempotency и хронологию. Ошибка Redis после
DB commit не превращает успешную mutation в ложный отказ: UI получает
durable definition без `nextRunAt`, а bounded reconciliation повторно
синхронизирует включённые и удаляет scheduler отключённых definitions.
Истёкший тариф не скрывает сохранённые расписания и историю: read projection
показывает последний immutable plan limit, но новые включения и provider calls
по-прежнему fail-closed.

## 8. Проверенное состояние

- Prisma Client generation: pass для 4 сервисов.
- Prisma schema validation: pass для 4 сервисов.
- TypeScript strict typecheck: pass для 8 пакетов.
- Platform API tests: 455 pass, 0 fail, 5 opt-in PostgreSQL 18 tests skipped
  без отдельного disposable database URL.
- SEO data tests: 139 pass, 0 fail, 1 disposable-DB test skipped.
- Jobs/integrations tests: 483 pass, 0 fail, 10 disposable-DB tests skipped
  в обычном запуске; startup decrypt-canary targeted suite — 7/7 pass.
- Realtime unit tests: 112 pass, 0 fail.
- Contracts unit tests: 100 pass, 0 fail.
- Unified Web helper tests: 159 pass, 0 fail.
- Infrastructure DB-role/connector и затронутый rank dependency targeted
  scope: 9 pass, 0 fail; PostgreSQL regressions остаются opt-in в обычном
  запуске.
- Infrastructure suite после Redis/NATS/crawl hardening: 89 pass, 0 fail и пять
  opt-in PostgreSQL skips с локальным Redis 8.8.1 binary. Отдельный live smoke
  на source-built Redis 8.8.1: 3/3 pass; подтверждены BullMQ Queue/Worker,
  queue-key isolation и Lua denial, versioned Realtime Pub/Sub channels,
  Directus cache-команды, health/default users и запрет admin/dangerous
  commands. Live NATS 2.12.12 smoke подтвердил четыре bcrypt identities,
  отсутствие plaintext-password warning и topology create → unchanged.
- Свежий user-space PostgreSQL 16 compatibility rehearsal: все 30 Jobs и 15
  SEO Data migrations применены отдельными полными цепочками с test-only
  `uuidv7()` shim. Live rollback-smoke подтвердил crawl Job checkpoint
  constraint, tenant Page FK, immutable snapshot/occurrence trigger и issue
  evidence.
  Целевой PostgreSQL 18 runtime/race gate остаётся обязательным перед
  production rollout.
- Отдельный fresh PostgreSQL 18 service-role proof: pass; применены 37 Prisma
  migrations четырёх сервисов, подтверждены runtime CRUD/UUIDv7/constraints,
  запреты DDL/`_prisma_migrations`/`TRUNCATE`/membership/ownership/
  cross-database/replication/`PUBLIC` bypass, Directus exception, exact
  connector grants и реальный first-match HBA login/reject.
- Fresh PostgreSQL 18 sitemap gates: полная цепочка из 17 SEO Data migrations
  и 132/132 теста прошли без skip; полная Jobs migration chain принимает
  legacy checkpoint v1 и bounded checkpoint v2, но DB constraint отклоняет
  неполный v2. Та же Jobs migration применена к живому runtime.
- Fresh PostgreSQL 18 conditional/backoff gates: полная цепочка из 18 SEO
  Data migrations и 135/135 тестов без skip подтверждает exact validator,
  immutable `304` reuse, перенос issues и sitemap-only diff; полная цепочка
  из 32 Jobs migrations и opt-in integration подтверждает сериализацию
  глобального host state, `Retry-After`, recovery и latency backoff.
- Fresh PostgreSQL 18 duplicate-group gate: полная цепочка из 19 SEO Data
  migrations, Prisma validate/generate и реальный snapshot integration
  проходят; проверены три immutable analysis/group/member таблицы,
  tenant-safe FK, bounded counts и запрет изменения terminal evidence.
- Fresh PostgreSQL 18 crawl-membership gate: полная цепочка из 20 SEO Data
  migrations и реальный snapshot integration проходят; same-scope complete
  crawl фиксирует исчезнувший URL, partial и изменённый scope не создают
  ложных evidence, повторное появление закрывает current issue, а обе
  membership/absence таблицы отклоняют mutation.
- Fresh PostgreSQL 18 Radar schedule gate: полная цепочка из 33 Jobs
  migrations применена без пропусков, таблицы definitions/runs и immutable
  guard trigger проверены. Live Redis 8.8.1 gate выполняет BullMQ
  scheduler/worker round-trip для `rank-automation` и `crawl-automation`;
  отдельный runtime restart и повторный полный user smoke подтвердили
  исправленный ACL/readiness без worker error loop.
- Fresh PostgreSQL 18 site-pause gate: полная цепочка из 35 Jobs migrations
  и реальный host-state integration проходят; шестой последовательный
  rate-limit/unavailable/network/latency signal переводит global host в
  `SITE_PAUSED` минимум на 24 часа, а успешный ответ сбрасывает series.
- Обе conditional/backoff migrations применены к живому PostgreSQL 18
  runtime; все HTTP/Web/MinIO health endpoints отвечают `200`, ClamAV ready,
  повторный crawl `019fb769-a26b-7a86-9a44-c6d8fe4f732e` завершён, а его
  единственный snapshot имеет `not_modified=true` и ссылку на исходный
  immutable snapshot.
- Duplicate-group migration применена к живому runtime. Полный public smoke
  `019fb7e1-21c8-7060-8a9c-934cae802363` прошёл без ошибок: primary crawl
  `019fb7e1-247b-79f9-b474-575f9b688da6` обработал два URL, duplicate-group
  read model подтверждён, manual automation crawl завершился через `304`,
  затем успешно прошли pause и полный XLSX upload/inspection/import/publish.
  PostgreSQL и Node process environments фактически подтверждены как UTC.
- Crawl-membership migration применена к живому PostgreSQL 18 runtime.
  Полный public smoke workspace
  `019fb7f6-14a6-73c9-b434-1171c8e25128`, project
  `019fb7f6-1579-7109-953f-89f7525d6786`, crawl
  `019fb7f6-182b-76bb-b55f-d6a9c46a6cc4` прошёл новый absence endpoint,
  duplicate groups, manual Radar automation и весь XLSX import; live evidence
  содержит два complete analysis, два разных scope и ноль ложных absences.
- Site-pause migration применена к живому runtime. Регрессионный public smoke
  workspace `019fb7fd-6fe3-7aef-9eb6-91ec322a0fe4`, crawl
  `019fb7fd-7340-7918-b5ca-34154bc9a9d5` снова прошёл обычный и automation
  crawl, duplicate/absence reads и полный XLSX import/publish; destructive
  шестикратный failure against публичного сайта намеренно проверяется только
  в disposable PostgreSQL integration, а не на внешнем host.
- Полный root `pnpm test` после startup-canary и scoped claim: pass без
  failures; обычный запуск безопасно пропускает opt-in disposable-DB tests.
  Отдельный fresh PostgreSQL 18 gate для Jobs grant/claim: 4/4 pass.
- Root lint: pass на pinned Oxlint 1.76.0 с Import, React, Promise и Node
  plugins и `--deny-warnings`.
- NestJS production build: pass для 4 сервисов.
- Next.js production builds: pass для Web и Admin; в Web проверены public
  site, Toolbox, API docs и private `/app`.
- Compose config: предыдущий baseline pass с `.env.example` и ephemeral
  overrides для намеренно пустых dedicated token examples. Текущая grant-token
  проводка защищена static scope tests; повторный render недоступен без Docker
  на этом хосте и остаётся CI/staging gate.
- Предшествующие Jobs migrations и connector column grants: pass на локальном
  PostgreSQL 16; отдельно проверены запреты `INSERT`, ciphertext/outbox
  access, ownership и `BYPASSRLS`. Полная цепочка из 13 Jobs migrations,
  включая `rank_estimates`, `ACTION_REQUIRED` и `rank_job_runs`, повторно
  применена fresh на PostgreSQL 15 с test-only `uuidv7()` shim; целевой
  PostgreSQL 18 повторяется в staging.
- Resolved Compose topology: outbound-required Jobs runtimes имеют
  `internal,outbound`; connector не публикует ports и не получает
  management/NATS credentials.
- Rank-worker Dokploy topology: static tests pass; process использует только
  `internal`, 17 allowlisted env keys, отдельные manifest/grant/result rank
  tokens, принудительный disabled submit и не получает
  ports/outbound/NATS/S3/SMTP/vault credentials.
- Visual QA: 1440, 1024 и 390 px; horizontal overflow не найден.
- Semantics upload browser QA: 1280 px, runtime errors и horizontal overflow
  не найдены; устранён CSS conflict публичного `.brand` с app shell.
- Mapping/publish wizard browser QA: реальный multipart flow через mock S3/API,
  1440 и 390 px; document overflow и browser errors не найдены, таблица
  прокручивается только внутри своего контейнера, singleton mapping и
  обязательный separator проверены интерактивно.
- Notification preferences browser QA: profile/project screens на 1280 px,
  а также mobile recheck на 390 px; document overflow и browser errors не
  найдены, минимальный текст 11 px; override, live effective preview, pause и
  успешный optimistic save проверены интерактивно.
- Notification center browser QA: 1280 px, document overflow и browser errors
  не найдены; unread badge, одиночное чтение, unread filter, read-all и empty
  state проверены интерактивно.
- Browser Web Push Web: strict typecheck, 78/78 tests, production build и
  diff-check — pass. Покрыты IndexedDB v1→v2 migration, multi-tab/Service
  Worker generation-CAS, delayed stale PUT re-arm, exact subscription match,
  corrupt/future record recovery, strict payload/deep-link validation и
  same-origin BFF body limits. Protected visual/e2e с живыми API и browser
  permission остаётся staging gate.
- Integration settings browser QA: 1440 и 390 px, document overflow и browser
  errors не найдены; таблица/табы прокручиваются только внутри контейнеров,
  XMLStock full-secret replacement проверен интерактивно.
- Project connector settings: production build и same-origin BFF smoke pass;
  отдельно проверены cross-workspace deep link, reconnect race, immutable
  create replay, `412/409`, bounded options и mobile overflow. Интерактивный
  browser backend в текущем окружении недоступен, поэтому новый экран требует
  повторного visual smoke после удалённого deploy.
- Tracking context SEO Data: Prisma validate/generate, strict typecheck,
  production build pass. Fresh full SEO migration chain применён на локальном
  PostgreSQL 15; fail-closed/concurrent-writer сценарии и повтор на целевом
  PostgreSQL 18 остаются staging gates.
- Tracking context Platform API: strict typecheck, 116 unit tests, production
  build и diff-check pass. Compiled bootstrap зарегистрировал новые modules и
  routes без DI errors; startup остановился только на ожидаемо недоступном
  тестовом NATS.
- Tracking context Web: strict typecheck, 44 helper/BFF tests, production
  build и diff-check pass; private/noindex route входит в build. BFF PUT и
  client helpers покрыты тестами. Защищённый browser visual/e2e не запускался
  без live auth/API и остаётся обязательным после удалённого deploy.
- Provider-free rank estimate: Contracts 9/9, SEO Data 28/28, Platform API
  128/128, Jobs/integrations 159/159 и Web 54/54 tests; strict typecheck,
  production build и diff-check проходят. Проверены exact replay после
  mutable snapshot drift, concurrent winner, bounded SEO response,
  credential projection без secret columns, finite blockers, 1001 sentinel,
  TTL и redaction. Живой PostgreSQL 18 migration smoke и защищённый visual/e2e
  остаются staging gates.
- Manual rank execution contracts: 12/12 targeted tests, strict typecheck,
  production build и diff-check — pass. Review findings по nullable estimate
  hash matrix, provenance, TOAST preflight, semantic dedup и full sealedBy
  integrity устранены; проверены finite lifecycle/status, public redaction,
  canonical ingest provenance, finalize/late-ingest ordering и terminal
  count invariants.
- Immutable rank manifest SEO Data: Prisma validate/generate, strict
  typecheck, 51/51 tests, production build и diff-check — pass. Fresh
  migrations и state/provenance/active-dedup negative smoke прошли на
  PostgreSQL 15; target PostgreSQL 18 остаётся release gate.
- Durable rank preparation Jobs: Prisma validate/generate, strict
  typecheck, 213/213 executable tests, production build и diff-check — pass;
  обычный suite дополнительно содержит два skipped disposable-DB tests.
  Fresh 13-migration deploy, реальные lifecycle/immutable negative checks и
  `Job → RankJobRun` concurrent lock-order test прошли на PostgreSQL 15 с
  test-only `uuidv7()` shim.
  Node.js 24 и PostgreSQL 18 остаются staging gates. Live provider submit,
  ingest и completion event в этот срез не входят.
- Platform API execution-grant issuer: Contracts 11/11, Platform API 59 pass
  и 3 opt-in PostgreSQL 18 tests skipped, infrastructure scope 2/2; Prisma
  validate/generate, strict typecheck, lint, production build и diff-check —
  pass. Review findings по usable TTL, early-error `no-store`, exact expired
  replay, reservation coherence и production secret scope устранены.
- Jobs grant intent/consume foundation: bounded client/config/lock/evidence/
  state unit, secret-free connector execution и static migration coverage
  добавлены. Prisma validate/generate, strict typecheck, 271 executable tests,
  lint, production build и diff-check — pass; обычный suite дополнительно
  содержит два skipped disposable-DB tests. Fresh full migration chain,
  claim-specific concurrent claim/reclaim, stale-head, cancel, credential и
  immutable kill-switch regression прошли на PostgreSQL 18. Остальные
  negative/race smoke migrations
  `20260729230100_rank_execution_grant_attempts` и
  `20260729230200_rank_connector_executions` учитываются отдельным gate.
- Shared canonical JSON: official RFC 8785 primitive/key-order/UTF-8 vectors,
  hostile values/accessors/cycles/Proxy fail-closed; server-only subpath
  resolution из SEO Data проверен. Production dependencies не добавлялись.
- Identity session-family producer: Contracts 16/16 и Platform API 175/175
  tests, strict typecheck/build/diff-check, Prisma validate/generate — pass.
  Проверены exact redacted payload, whole-family/idempotent revoke, чужая
  session, stale principal/version, refresh reuse/expiry commit-before-401,
  reset и MFA ordering. Реальные PostgreSQL 18 race/outbox rollback tests
  остаются staging gate; Prisma schema/migration в этом срезе не менялись.
- Identity session-lineage/inventory: Platform API 329 pass + 4 opt-in skips,
  Web 131/131 и Contracts 76/76; typecheck/lint/build, Prisma validate/generate,
  diff-check и live PostgreSQL 18 migration smoke — pass. Проверены immutable
  family TTL/recent-auth, encrypted user-bound cursor, полный Web pagination
  без partial fallback, 401 refresh и canonical single-hop BFF client IP.
- Workspace/project settings Web: typecheck, scoped lint, 139/139 tests,
  production build с обоими private routes и diff-check — pass. Проверены
  permission/read-only/offline/error states, `If-Match`, draft-preserving
  conflict recovery, duplicate-domain confirmation и archive/restore без
  delete path.
- Identity durable transport/expiry: targeted Platform API publisher,
  bounded global sweeper, Realtime consumer и infrastructure topology/ACL
  suites проходят. Полный root lint/typecheck/test/build для общего текущего
  worktree выполняется отдельным финальным gate после объединения срезов.
  Отдельный localhost smoke с `nats-server` 2.12.12 подтвердил синтаксис
  config, create → unchanged idempotence и publisher/consumer/provisioner ACL.
  Полный Compose render на этом хосте не запускался из-за отсутствия Docker и
  остаётся CI/target-environment gate.
- Realtime revoked-family application handler: Prisma validate/generate,
  strict typecheck, 47/47 tests, production build и diff-check — pass.
  Покрыты оба порядка event/registration, exact duplicate, второй event ID,
  scope collision, rollback и сохранение валидного delivery snapshot.
  Platform API targeted mapping tests 8/8 и typecheck — pass. Fresh migration
  и реальные concurrent transactions остаются PostgreSQL 18 staging gate.
- Realtime project authorization: browser-safe contracts, Platform API
  CSRF/session/`presence.view` boundary, hash-only ticket owner и Socket.IO
  server-derived rooms проверены. Realtime Prisma validate/generate,
  typecheck, scoped lint, 112/112 tests и production build — pass; targeted
  Platform API tests 8/8 и BFF tests 11/11 — pass. Migration
  `20260730170000_realtime_project_tickets` успешно применена на локальном
  PostgreSQL 18.4; target-volume concurrency/restore остаются release gate.
- HTTP response security policy: Platform API 278 executable tests pass и 3
  opt-in PostgreSQL tests skipped, Web 105/105, Admin 2/2; strict typecheck,
  root lint и production builds всех трёх packages — pass. Fastify injection
  покрывает private override/Vary merge, parser/guard/404/internal paths и
  proxy-aware HSTS. Next production manifests подтверждают общие security
  headers, отдельный `/app`/Admin private-noindex policy и отсутствие
  public marketing cache override. Full script/style CSP и повторный HTTPS
  smoke через фактический target production proxy остаются release gates.
- Integrated preview gate 2026-07-30: root typecheck и strict lint проходят;
  полный root test проходит, включая Platform API 339 pass + 4 opt-in skips,
  Jobs 334 pass + 9 opt-in skips и infrastructure 74 pass + 5 opt-in skips;
  Web 144/144 tests и production build всех пакетов проходят на Node.js
  24.18.1. Локальный PostgreSQL 18.4 принял все четыре migration chains.
- Transactional auth-email gate 2026-07-30: contracts 97/97, Platform API
  363 pass + 4 opt-in PostgreSQL skips, Jobs 389 pass + 9 opt-in PostgreSQL
  skips, Web 149/149 и infrastructure 80 pass + 5 optional PostgreSQL/Redis
  skips; полный root lint/typecheck/test/build, Prisma validate/generate и
  `git diff --check` проходят. Docker, локальные PostgreSQL/Redis binaries и
  production SMTP credentials на текущем хосте отсутствуют, поэтому Compose
  render, disposable DB/Redis smokes и внешний SMTP canary остаются
  CI/staging/operator gates, а не заменяются unit-тестами.
- P1 semantic editor gate 2026-07-30: contracts 97/97, SEO Data 104/104,
  Platform API 369 pass + 4 opt-in PostgreSQL skips, Web 149/149,
  infrastructure 80 pass + 5 optional PostgreSQL/Redis skips; root lint,
  typecheck, tests, production build, SEO Data Prisma validate/generate и
  `git diff --check` проходят. Живой migration/E2E на этом VPS пока блокирует
  отсутствие container runtime и passwordless sudo; кодовый slice остаётся
  готовым к применению в Compose, но не выдаётся за live production proof.
- P1 filters/saved views gate 2026-07-30: SEO Data 109/109, Platform API
  372 pass + 4 opt-in PostgreSQL skips, Web 149/149; affected-package
  typecheck, root strict lint, tests, production build, SEO Data Prisma
  validate/generate и `git diff --check` проходят. Живое применение migration
  остаётся отдельным gate до доступного PostgreSQL runtime.
- P1 typed custom columns gate 2026-07-30: SEO Data 113/113, Platform API
  375 pass + 4 opt-in PostgreSQL skips, Web 149/149; root strict lint,
  affected-package typecheck/tests, Prisma validate/generate, production
  build всех пакетов и `git diff --check` проходят. Live PostgreSQL migration
  и browser E2E остаются невыданным gate на текущем VPS.
- Live HTTPS preview 2026-07-30: Caddy short-lived IP TLS → loopback router →
  production Web/API/SEO Data/Jobs/Realtime; все обязательные readiness
  dependencies имеют `ok`. Реальный same-origin login вернул secure
  access/session/CSRF cookies, `/app`, `/app/settings/team` и workspace BFF
  ответили `200` с private/no-store/noindex, а внешний Socket.IO WebSocket
  upgrade ответил `101`. Preview использует disposable PostgreSQL и
  намеренно выключенные S3/ClamAV/email/Web Push/provider-submit adapters;
  это интеграционный smoke, а не production deploy.
- Target runtime: Node.js 24. Текущий полный lint/typecheck/test/build baseline
  проверен на Node.js 24.18.1; контейнеры также используют Node.js 24.
- P3 billing + first entitlement gate 2026-07-31: полная цепочка 10 Platform
  API migrations применена на новой PostgreSQL 16.14 БД; 6 plans, 11 prices
  и 5 system ledger accounts подтверждены. Live negative smokes блокируют
  второй trial владельца, direct POSTED/unbalanced ledger, entry mutation и
  TRUNCATE. Root typecheck/lint/tests проходят: contracts 98, Platform API
  414 + 4 opt-in skips, Jobs 415 + 9 skips, SEO Data 116, Realtime 112, Web
  154, Admin 4, infrastructure 82 + 5 opt-in skips. Production build всех
  deployable проходит и содержит `/app/settings/billing`.
- P3 finance operations 2026-07-31: migration добавляет append-only
  `platform_staff_role_assignments` и корректную replacement lineage
  NPD-чеков. Fresh 10-migration chain применён на PostgreSQL 16 compatibility
  harness; trigger-negative smoke, first-superadmin bootstrap и повторный
  fail-closed bootstrap проверены живой БД. Admin больше не содержит demo
  данных, требует MFA/recent auth/role и доступен через отдельный edge origin.
- P3 NPD receipt delivery 2026-07-31: четвёртое exact
  transactional-email событие замыкает manual registration/replacement на
  durable Jobs SMTP worker; JIT material сверяет tenant/version/status,
  расшифровывает recipient только в Platform API и валидирует официальный
  `lknpd.nalog.ru` URL. Contracts 100/100, Jobs 418 pass + 9 opt-in skips и
  infrastructure 82 pass + 5 opt-in skips проходят; внешний SMTP canary
  требует operator credentials. Fresh 27-migration Jobs chain применён на
  PostgreSQL 16 compatibility harness; новый allowlist принял NPD event и
  отклонил посторонний event type. Platform NPD integration также пройден
  на живой PostgreSQL.
- P3 semantic capacity enforcement 2026-07-31: trusted plan snapshot
  проводится через manual create, version undo, tracked-pair assignment и
  import confirmation. SEO Data сериализует workspace/project counters,
  учитывает незавершённые import reservations и освобождает их на complete,
  partial complete, cancel и final failure. Fresh 13-migration SEO Data и
  28-migration Jobs chains применены на PostgreSQL 16 compatibility harness;
  Prisma validate/generate, unit boundaries и migration contracts проходят.
- P2 rank automation gate 2026-07-31: fresh полная цепочка из 29 Jobs
  migrations применена на PostgreSQL 16 compatibility harness; Prisma
  validate/generate, Platform API 431 + 5 skips, Jobs 434 + 9 skips, Web
  157/157 и strict lint проходят. Redis 8.8.1 live-smoke 3/3 отдельно
  подтвердил новый Job Scheduler под production ACL, обычный Queue/Worker,
  tenant keyspace isolation и запрет опасных команд. Внешний Arsenkin canary
  остаётся отдельным operator gate до реального BYOK API key.

## 9. Следующий вертикальный срез

Ближайший обязательный billing-контур после
projects/seats/BYOK/keyword/tracked-pair/storage/automation entitlement:

`estimate/reservation/capture для provider usage →
sandbox checkout/autopay/refund/receipt E2E`

Критерий — каждая platform-paid команда проходит
estimate/reservation/settlement, а
успешная оплата создаёт и доводит до доставки официальный чек без ручного
изменения БД. До YooKassa shop credentials и юридической конфигурации внешний
live canary честно остаётся operator gate.

Следующий пользовательский P1-контур:

`live DB/browser E2E для semantics/versions/export → comments/presence`

Критерий — не наличие controller/service файлов, а browser E2E на живом
PostgreSQL: пользователь создаёт проект и структуру групп, добавляет и
редактирует запросы, выполняет bulk-команду, сохраняет view, экспортирует и
восстанавливает версию без tenant/permission leak и silent overwrite.

После automation vertical продолжается P2:

`provider incident telemetry → raw SERP policy → дополнительные rank
providers`

Provider-free estimate и SEO Data immutable manifest из ADR-2026-034
завершены; durable Jobs `PREPARING` saga, exact seal recovery, cooperative
cancel, public/Web Job lifecycle и normalized SEO Data result persistence
также готовы. Public bounded history proxy и private/noindex Web UI уже
подключены к internal read model. Authoritative one-time grant уже имеет
Platform-owned issuer/receipt, Jobs-owned intent/decision и атомарный
`CONSUMED ↔ rank_connector_executions/READY_TO_SUBMIT`. Scoped broker/claim,
exact connector permission и атомарный authorize/`SUBMITTING` готовы.
Immutable exact
provider request intent до grant теперь также хранится append-only, повторно
проверяется при grant replay и обязательно связан с connector execution.
Connector записывает documented wire request/task ID, durable poll state и
только normalized staged output; rank-worker отправляет exact ingest и
terminal finalize receipts. DB/Compose activation использует новую
kill-switch generation `arsenkin-positions@2`, а общий BullMQ limiter
ограничивает провайдера 30 запросами/минуту. Остаются live smoke с реальным
BYOK credential, операционные alert/circuit-breaker evidence и schedules.
Неоднозначность manifest preparation уже fail-closed переходит в
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN` без бесконечного auto-retry.

Terminal crawl notifications проходят effective profile/project policy,
durable idempotent in-app delivery и production-ready browser Web Push
transport по ADR-2026-039. Source outbox/dispatcher остаётся at-least-once, а
Realtime-owned DB attempts являются локальной durable queue. Операторские
VAPID credentials/profile в preview намеренно выключены. Следующему срезу
остаются source events остальных категорий, общий email/digest и delivery
history/test UI. Transactional auth-email по ADR-2026-038 остаётся отдельным
security flow.
OAuth/OIDC выполняется после подтверждения зависимости `jose`; QR для TOTP —
после подтверждения `qrcode`.

## 10. Незавершённые риски

- Дашборд использует честные empty states до первого rank data slice.
- Realtime не допускает вход в project rooms до общей token/permission проверки.
- Миграция backfill-ит `keyword_groups.path/path_hash` для корректного
  корневого дерева; orphan/cyclic legacy groups перед production требуют
  отдельного data-quality audit.
- `semantic_import_receipts` без chunks требуют bounded reconciliation/retention;
  receipt с применёнными chunks автоматически не удаляется.
- Durable publisher/consumer реализованы для
  `identity.session-family.revoked.v1` и четырёх transactional-email events;
  остальные event families требуют собственных allowlisted publishers/
  consumers, retention и replay runbooks.
- `rank_estimates` требуют bounded maintenance/retention после окна
  идемпотентных повторов и диагностики; expiry пока только запрещает считать
  receipt актуальным и сам не удаляет строку.
- `rank_snapshots` первого normalized slice пока не partitioned. До реальной
  нагрузки обязательны RANGE partitioning, partition maintenance/retention и
  representative history load test. Public history proxy/UI уже доступны,
  но не заменяют эти storage/load release gates.
- Notification preferences создают durable Web Push attempts для поступивших
  project notifications; sender/retry/fresh authorization/expiry/key canary
  реализованы. Остальные notification event producers, общий email/digest,
  rate-limited test command и delivery-history UI остаются незавершёнными.
- Transactional auth-email worker требует operator-managed production SMTP
  account/sender/credentials и canary evidence: этих секретов в repository
  нет. SMTP accept не атомарен с Jobs DB; crash до durable receipt может дать
  повтор со стабильным `Message-ID`, поэтому нужны ambiguity metric,
  reconciliation/runbook и fault-injection перед production.
- Identity terminal lifecycle ещё требует PostgreSQL 18 staging race tests
  `rotate ↔ rotate`, `login ↔ password reset`,
  `MFA challenge/confirm/disable ↔ reset`, outbox rollback, future
  suspend/deactivate producer и target-volume sweeper concurrency/load smoke.
- Web Push migration требует fresh apply и constraint-negative smoke на
  PostgreSQL 18 staging; VAPID/keyring rollout требует expand-first review и
  operator-managed provider canary. Same-version key replacement уже
  fail-closed проверяется persistent AES/HMAC canaries.
- Для rejected/quarantine objects ещё требуется production lifecycle policy и
  отдельный reconciliation/cleanup job; выдача и импорт таких объектов
  запрещены уже сейчас.
- Partitioned import staging требует retention/cleanup job и метрик роста до
  production; raw rows не считаются бессрочной историей.
- CSV/TSV и XLSX включены. XLSX использует bounded temporary spool,
  `unzipper-esm` central-directory entry streams и `saxes`, выбирает первый
  видимый лист, читает shared strings/cached formula values/dates и
  fail-closed ограничивает zip bomb/XML/row budgets. Известные production
  advisories удалены lockfile overrides; `pnpm audit --prod` чист.
  Выбор нескольких листов, ZIP из нескольких файлов остаются следующим
  wizard slice, а legacy XLS требует изолированного LibreOffice worker с
  отдельными CPU/RAM/time limits.
- ClamAV требует отдельного memory/capacity budget на VPS; concurrency
  inspection worker ограничивается независимо от API.
- MinIO CORS для exact Web origin и доступ browser к `ETag` подтверждены
  живым multipart smoke; buckets versioned и app user ограничен отдельной
  policy. Retention rejected/quarantine objects и автоматический abort
  incomplete multipart всё ещё требуют lifecycle/cleanup job.
- Нет production observability и проверенного backup/restore runbook.
- Billing migration `20260731023000_billing_foundation` создаёт versioned
  catalog, subscription/order/payment/refund/method, webhook inbox,
  double-entry ledger и NPD obligation. Fresh full Platform API chain
  применён на локальном PostgreSQL 16; balanced posting, direct POSTED insert,
  update/delete и TRUNCATE guards проверены живыми negative smokes. Целевой
  PostgreSQL 18, YooKassa sandbox/live checkout, webhook ingress, saved-method
  autopay и refund canary остаются release gates. Production startup требует
  reconciliation и webhook source-IP validation при включённой YooKassa.
- Тарифные entitlements являются authoritative transaction guard для
  projects, seats, `CLIENT` role, keywords, storage, tracked pairs,
  scheduled automations и controlled-beta BYOK grant. Guest reports/API
  limits ещё требуют owner-service meters, а system-provider usage пока не проводит
  estimate/reservation/capture через новый ledger. До замыкания этих
  контуров биллинг нельзя считать полным коммерческим enforcement.
- Manual NPD obligation создаётся идемпотентно после verified
  `payment.succeeded`. Operations-панель сохраняет только точный HTTPS print
  URL `lknpd.nalog.ru`, сверочные подтверждения, cancellation после полного
  refund и replacement на остаток после частичного refund; роли persisted и
  append-only. Email-доставка, bounded retry/bounce и durable redacted
  attempt history подключены к transactional transport; live SMTP canary и
  bounce/reconciliation runbook остаются operator gate. Использовать
  неофициальный API «Мой налог» или хранить его пароль запрещено.
- KEK rotation runbook описан в `platform-infrastructure/README.md`, но
  автоматический bounded DEK rewrap ещё не реализован. DB-aware startup
  coverage работает fail-closed; до rewrap старые используемые KEK запрещено
  удалять. Fingerprint keyring ротируется независимо; bounded-инвалидация
  старых fingerprints после retry window также ещё не реализована.
- Номерная coverage дополнена persistent authenticated canary для равенства
  key material. `MANAGEMENT` expand-only регистрирует immutable synthetic
  envelope каждой configured KEK version; `EXECUTION` передаёт broker все свои
  configured versions (не более 128), а получает их объединение с versions,
  реально используемыми неудалёнными credentials, и явный usage marker.
  Поэтому новый ещё не active KEK проверяется на каждой replica до
  переключения, used-but-unconfigured version останавливает startup, а retired
  unused historical canary больше не требует сохранения ключа. Missing canary
  остаётся nullable строкой и вместе с corrupt/wrong-key envelope блокирует
  создание BullMQ worker. Canary не содержит tenant credential data; пустой
  vault допустим. Validation worker оставляет credential без изменений и
  делает job-only bounded retry при любом последующем decrypt failure, поэтому
  mismatch не превращается в массовый `DISABLED`. Cluster-wide circuit
  breaker/incident alert после startup ещё отсутствуют. Rollout: expand
  keyring → canary verify configured ∪ used versions → drain старых replicas →
  switch active.
- `MANAGEMENT` и `EXECUTION` процессы пока получают один symmetric KEK.
  Role guard запрещает штатный decrypt в management adapter, но не даёт
  криптографической изоляции при компрометации процесса; целевая граница —
  KMS/asymmetric wrapping или отдельный credential broker.
- Summary-list credentials пока без cursor pagination и tenant hard limit;
  перед массовыми provider pools нужен bounded endpoint, хотя ciphertext и
  wrapped DEK уже исключены Prisma `select`.
- Foundation DDL migration vault обёрнута в явную транзакцию, а предшествующая
  enum migration намеренно применяется отдельным committed шагом; все
  проверены `prisma validate`. Vault и credential-validation migrations,
  включая CHECK/partial UNIQUE/CAS, успешно применены на локальном
  PostgreSQL 16; повторная staging-проверка на целевом PostgreSQL 18 остаётся
  обязательной.
- Project binding migration также выполняется одной транзакцией и fail-closed
  останавливается при непустой pre-release `integration_bindings`; для такого
  окружения нужен expand → backfill → validate → contract план. Fresh и
  fail-closed сценарии проверены на PostgreSQL 16. Перед precondition таблица
  блокируется `ACCESS EXCLUSIVE`, и concurrent-writer smoke подтвердил
  отсутствие окна check → DROP; PostgreSQL 18 остаётся staging-gate.
- Versioned tracking context migration fail-closed требует пустые
  pre-release `tracking_contexts`, `rank_snapshots` и `current_ranks`, удерживая
  их `ACCESS EXCLUSIVE` от проверки до destructive contract step. SQL,
  constraints и migration-order проверены тестами; fresh apply прошёл в
  полном SEO migration chain на PostgreSQL 15. Fail-closed/concurrent-writer
  сценарии и PostgreSQL 18 остаются staging-gate.
- Rank manifest migration fresh apply и negative lifecycle/provenance/
  active-dedup smoke прошли на PostgreSQL 15. PostgreSQL 18, реальная
  concurrent transaction гонка и rollback/failure injection обязательны до
  release.
- `rank_estimates`/rank preparation migrations согласованы с Prisma,
  fail-closed проверяют legacy manual rows и active dedup conflicts и прошли
  fresh/constraint-negative smoke на PostgreSQL 15. Обычный rebuild unique
  index требует worker drain/maintenance window; для большой live-БД нужен
  expand/concurrent-index план. PostgreSQL 18 smoke обязателен до deploy.
- `rank_execution_grant_receipts` прошли fresh migration и opt-in
  quota/TTL/immutability, concurrent exact winner и lifecycle race smoke на
  PostgreSQL 18. В обычном suite без отдельного disposable
  `PLATFORM_API_RANK_GRANT_TEST_DATABASE_URL` эти тесты безопасно пропускаются.
- `rank_execution_grant_attempts`, `rank_connector_executions`, claim и split
  `SUBMITTING`/authorize migrations прошли fresh full-chain apply на
  PostgreSQL 18. Grant/consume, claim/reclaim/stale-head/drift, authorize/
  replay/rollback/expiry, upgrade ACL и exact non-owner permission regressions
  пройдены. Fresh cluster service-role provisioning/audit также пройден;
  target-environment HBA order/login smoke остаётся deploy gate.
- Issuer receipt и Jobs-owned `CONSUMED/READY_TO_SUBMIT` сами не авторизуют
  provider call. Claim создаёт bounded pre-network lease, а authorize только
  после full Job/cancel/credential/grant/control/fence recheck commit-ит
  `SUBMITTING` marker. Отправлять bytes до этой commit-точки запрещено; после
  неё crash/ambiguity никогда не разрешают автоматический resubmit. Runtime
  caller и дальнейшие durable provider states пока отсутствуют.
- Проверка lifecycle проекта сейчас авторитетна в Platform API, но между ней и
  commit в jobs database остаётся межсервисное TOCTOU. До первого исполняемого
  rank job jobs/integrations обязан получить project/workspace lifecycle
  projection либо другую authoritative precondition, а execution всегда
  повторно проверяет lifecycle/billing.
- Terminal credential validation пока не создаёт transactional outbox event:
  email/Web Push и полный durable audit результата требуют отдельного
  redacted события.
- Credential validation имеет global BullMQ limiter и DB-enforced
  per-credential/material single-active cap, но ещё не имеет server-side
  per-workspace/provider quota и справедливого планирования между tenants.
- Connector worker использует отдельный PostgreSQL login без direct table
  DML; exact `SECURITY DEFINER` allowlist выдаёт только due IDs, одну
  lease-bound encrypted projection и fenced finish. Claim держит credential
  lock до свежих DB clock/token, возвращает `leaseExpiresAt`, а worker требует
  запас lease не меньше provider timeout + 2 секунды; Arsenkin success metadata
  проходит exact DB invariant. Fresh PG18 non-owner/lock-wait tests доказали
  direct/Public denial, concurrency/reclaim/stale/material/pg_temp invariants.
  Отдельный fresh 19-migration provisioning proof подтвердил SCRAM, обе стороны
  membership fail-closed, cluster/current-schema ACL audits, отсутствие DML/
  PUBLIC/management access и точный claim/authorize allowlist. Generated HBA
  и fixed-role PG18 harness закрывают cross-DB `PUBLIC CONNECT`; global vault
  read внутри `jobs_db` закрыт. До production нужен повтор permission/HBA/login
  proof в целевом окружении. Роль с ownership объектов script отклоняет.
  Compose уже разделяет Jobs, Realtime и Directus Redis instances/networks и
  выдаёт семь Jobs queue-scoped identities, channel-only Realtime identity и
  отдельный Directus cache user. Core Redis 8.8.1 live compatibility пройдена
  локально на собранном official source; до production остаются startup smoke
  pinned OCI image вместе с Directus, rollout/drain старого `redis_data`,
  memory/AOF/latency alerting, representative load и restore evidence.
- Job idempotency/lease migration намеренно fail-closed требует пустую
  pre-release таблицу `jobs`; для окружений с данными до deploy обязателен
  отдельный expand → backfill → validate → contract план.
- Validation registry пока хранит только текущую connector version: rolling
  deploy между enqueue и execution может дать `CONNECTOR_VERSION_CHANGED`.
  До production нужны N/N−1 version support либо queue drain перед rollout.
- Directus collection schema и seed появятся вместе с CMS vertical slice.
- Email-verification/password-reset/invite/NPD receipt используют один
  allowlisted durable transactional worker; plaintext token и billing PII
  не попадают в NATS/Jobs DB и не логируются.
- QR для TOTP пока представлен локальным `otpauth://` URI и ручным ключом;
  UI QR появится после подтверждения зависимости `qrcode`.
- Arsenkin position execution и daily/weekly schedule orchestration
  реализованы; до production live BYOK canary остаются обязательны provider
  credentials владельца и incident telemetry/circuit breaker. Keys.so теперь
  поддерживает credential validation и полный competitor organic keywords
  collection/preview/import; до production остаётся live canary на реальном
  тарифе владельца. XMLStock validation и Wordstat runtime реализованы по
  официальному contract; до production остаётся live canary на реальном
  ключе/балансе владельца и provider incident telemetry/circuit breaker.
- Technical crawl production vertical закрывает ручной bounded обход,
  sitemap/include/exclude/query scope, conditional page requests, global
  host backoff, current issues, page diff history, группы дублей
  content/Title/Description/H1, exact-scope исчезновение страниц и versioned
  daily/weekly schedules с quiet windows/no-overlap/fresh execution
  authorization. Duplicate и membership analysis выполняются идемпотентно
  под project lock, учитываются в общем issue count и доступны через
  tenant-protected API/UI с immutable evidence.
  Для полного Radar из раздела 10 ТЗ остаются общий notification email
  transport, операторский Web Push canary и отдельный browser-rendering pool.
  Cookies/custom headers не принимаются до
  отдельной secret-safe policy.
- `platform-app` сохранён как legacy Git-источник до проверки переноса; новая
  функциональность добавляется только в `platform-web`.

## 11. Правило обновления карты

Добавлять только информацию, необходимую следующему разработчику:

- новая граница;
- новый entrypoint;
- новая очередь/event;
- новая база/таблица;
- новый обязательный env;
- изменившийся startup/data flow;
- текущий незавершённый риск.

Детальные поля и UX не копировать сюда — давать ссылку на ТЗ или README сервиса.
