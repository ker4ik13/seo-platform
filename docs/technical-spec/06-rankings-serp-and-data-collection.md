# Позиции, SERP и сбор данных

## 1. Tracking context

Позиция не существует без контекста. Контекст включает:

- search engine;
- country;
- provider-neutral platform region code/label;
- language;
- device;
- result depth;
- domain matching rule;
- safe search;

Один проект может иметь несколько активных контекстов. Контексты имеют человекочитаемые названия.

В пользовательском интерфейсе tracking context называется «профиль съёма»:
это сохранённое сочетание поисковика, региона, устройства, языка, глубины и
правила определения URL проекта. Экран профилей использует master-detail:
компактный список профилей, параметры выбранного профиля, оценку запуска и
назначенные ему ключи без отдельного перехода.

Editable launch profile сохраняет тип выдачи, XMLStock-режим обхода
`STRICT_DEPTH|STOP_AFTER_FOUND`, выбор Turbo для Яндекс Live и охват следующего
запуска: весь проект, точный список либо набор папок. Папки отображаются вложенным
раскрываемым деревом; обычный checkbox включает только прямые запросы папки,
а компактная кнопка «Вложенные» отдельно включает и отмечает потомков. Сервер
при сохранении проверяет каждую папку внутри текущего tenant scope. Перед повторным запуском
UI сравнивает materialized scope с последним назначенным keyword set и
предупреждает о новых запросах. Выбор сохранённого профиля сначала полностью
восстанавливает назначенные `keywordId`, текущий текст и optimistic version;
новый профиль начинает с явного выделения, переданного из таблицы. Provider не
становится частью context: браузер хранит project-scoped предпочтение точного
credential ID последнего успешного запуска, проверяет его среди текущих
effective подключений и помечает только это подключение. Credential ID не
публикуется в context или job summary и не переносится между браузерами.
Новый профиль позиций для России начинает с Москвы: Яндекс `213`, Google
`1011969`. После принятого запуска браузер сохраняет последний регион отдельно
для проекта и поисковика; последняя серверная rank-задача с активным context
является более сильным источником при восстановлении.

Точный список в общем scope-picker не ограничен первой presentation-страницей:
Web читает его keyset/cursor-страницами по 200 строк и подгружает продолжение у
нижней границы прокручиваемого окна. Поиск начинает новую cursor-цепочку, а уже
выбранные canonical keyword ID/version не теряются. Список запросов по
умолчанию заполняет доступную высоту третьей колонки мастера, а дерево папок
занимает высоту своего содержимого до того же доступного максимума, не
растягивая малое число строк. На desktop пользователь может изменить высоту
обоих списков вертикальным resize.

Охват всего проекта или нескольких папок разрешается отдельно от
presentation-списка: Web debounce-ит быстрое переключение, передаёт все
разрешённые папки одним union-фильтром в
`POST keywords/operation-scope`. Первая облегчённая страница возвращает точный
distinct count, поэтому UI сразу показывает размер охвата и не materialize-ит
строки, если превышен лимит провайдера. Допустимый scope затем читается
фоновыми страницами по 10 000 строк только как `id/version/isTracked`. Это исключает прежний
последовательный обход «папка × страница» и повторный расход на запросы,
состоящие сразу в нескольких папках. Назначения
сохранённого tracking context также читаются bounded-страницами до 1000 строк;
для охвата `ALL/GROUPS` их фоновое сравнение не блокирует открытие редактора.

Список профилей не выполняет отдельный relation-count для каждой строки.
Конфигурации читаются bounded списком, а число активных назначений считается
одним tenant-scoped `GROUP BY context_id` с join на active keywords. Это
сохраняет точные `assignedKeywordCount` и не умножает сканирование большого
проекта на число профилей.

Настройки профилей вызывают серверную материализацию после загрузки и после
сохранения. Для `ALL` сервер заново выбирает все активные запросы проекта, для
`GROUPS` проверяет существование выбранных папок и собирает distinct keyword
ID; активные потомки добавляются только для тех выбранных корней, которые
присутствуют в `scope.descendantGroupIds`. Если `includeUntracked=false`, запросы
с `keywords.is_tracked=false` не входят в effective set. Архивные запросы и
папки не попадают в новый состав. Пересчёт ограничен тем же пределом 300 000
назначений и выполняется только в проверенном workspace/project scope.
Сохранённый `GROUPS` scope может пережить удаление папки: materializer
игнорирует отсутствующие корни и возвращает пустой effective set, когда
активных корней не осталось. Web удаляет недоступные UUID из редактируемого
draft. В каждой строке дерева с потомками есть собственная кнопка поддерева;
унаследованно включённые строки отмечаются checked. Если фоновый materialize успел изменить только version/assignment,
сохранение перечитывает authoritative context и ограниченно повторяет `PATCH`;
изменённые другим пользователем name/configuration/launch profile автоматически
не перезаписываются. Старый сохранённый профиль без `includeDescendants`
читается как включавший потомков всех выбранных корней; новая mutation всегда
записывает точный список `descendantGroupIds`.

По ADR-2026-033 provider/credential принадлежат project connector binding, а
schedule/timezone — automation. Экран может показывать их effective projection
рядом с context, но они не входят в immutable tracking configuration.
Provider-specific region ID и форма provider request получаются adapter
mapping при создании immutable execution manifest и не записываются обратно
в tracking context.

Turbo для XMLStock Яндекс Live сохраняется как явный default launch profile и
восстанавливается при выборе контекста. При каждом запуске выбор дополнительно
фиксируется immutable mapping `xmlstock-yandex-live@3`; обычный Live остаётся
на mapping `xmlstock-yandex-live@2`. Режим глубины так же сохраняется в
launch profile, а manifest получает его immutable копию. Старые контексты без
этих полей безопасно читаются как standard Live + `STRICT_DEPTH`.
Для обычного позиционного запуска XMLStock standard Яндекс Live и Google Live
контекст также принимает глубину TOP-10; это ровно одна provider-страница на
keyword. TOP-10 не переносится на Яндекс Search API, Arsenkin или Turbo и при
смене на несовместимый source/provider UI возвращает глубину TOP-30.

## 2. Конфигурация отслеживания

Экран позволяет:

- создать контекст;
- за одно сохранение создать отдельные профили для нескольких сочетаний
  города и устройства тем же bounded target selector, что используется в
  ручном мастере;
- выбрать запросы по view/group/tag/filter;
- сохранить в launch profile выбор `includeUntracked`;
- включить/исключить SERP features;
- настроить domain matching;
- выбрать хранение raw SERP;
- сделать test run.

Расписание, provider/fallback и budget настраиваются связанными automation и
connector policy, а не дублируются в context.

Экран настройки называется «Съём позиций» и содержит как редактор профилей,
так и список связанных расписаний. Rank automation поддерживает `DAILY`,
`WEEKLY` и отложенный одноразовый `ONCE` с точным UTC `runAt`. ONCE после
атомарного claim первого schedule run отключается с причиной
`ONE_TIME_COMPLETED`; повторное планирование требует нового будущего runAt.
No-overlap, optimistic version, manual run, pause/resume, max items и
failure-threshold одинаковы для UI и публичного API. Automation хранит явный
`maxPlatformChargeMicro` на один запуск: `0` означает BYOK-only. Перед каждым
scheduled/manual run Jobs вызывает закрытый Core dispatch, а Core заново
проверяет текущие RBAC, lifecycle, entitlement, quota, job capacity и trusted
price book. До fresh estimate Core через SEO Data заново materialize-ит
актуальный scope выбранного профиля; поэтому новые и перемещённые запросы,
архивация и текущий `isTracked` учитываются даже без открытия Web. Fresh
estimate переходит в обычный RankRun reservation/settlement
только когда точная цена не превышает cap; старые definitions нормализуются в
BYOK-only и не получают неявного права списывать внутренние токены.
Удаление расписания является soft-delete: scheduler снимается, запись
исключается из каталога и лимита активных расписаний, а связанные
`automation_runs`, Jobs, биллинг и результаты остаются в истории.

Изменение контекста не переписывает историю. Любое изменение поисковой
конфигурации создаёт новую immutable configuration version; rename,
archive/restore меняют только revision логической сущности.
Удаление контекста в пользовательском интерфейсе является soft-delete через
archive: контекст сразу исключается из каталога профилей и новых запусков, но
immutable manifests, результаты и история позиций сохраняют ссылку на него.
Restore остаётся явной API-операцией для административного восстановления.

Ручной мастер по умолчанию использует «Без контекста». Для такого запуска он
создаёт execution-only `tracking_contexts` с `is_reusable=false`: сущность и её
immutable configuration нужны estimate/manifest/history, но она не попадает в
каталог профилей или расписания. Переиспользуемый профиль применяется только
после явного выбора пользователя. Сбор выдачи конкурентов всегда использует
execution-only контекст и поэтому не создаёт сохранённых профилей.
Переключение с «Без контекста» на «Новый контекст» обязательно заново разрешает
выбранный `ALL/GROUPS` scope, хотя у обоих состояний до сохранения отсутствует
публичный context ID. При запуске новый reusable context сначала создаётся и
получает точный keyword set; только после успешной синхронизации UI переводит
его в состояние сохранённого профиля и перечитывает назначения. Поэтому
кнопка запуска не остаётся на нулевом scope, а платное подтверждение не теряет
подготовленный состав запросов.

## 3. Запуск съёма позиций

Wizard:

1. проект и scope;
2. tracking contexts;
3. provider selection;
4. параметры;
5. предварительная оценка;
6. подтверждение.

Один ручной запуск может включать до 64 сочетаний города и устройства. Для
каждого города пользователь независимо включает ПК, телефон или оба варианта;
каждое сочетание получает собственный versioned tracking context, estimate,
manifest и Job. Перед первым provider submit Web обязан подготовить и показать
все оценки. Для системного источника подтверждается сумма оставшихся оценок;
частично принятые задания не создаются повторно после сетевой ошибки, потому
что точные idempotency keys и публичные receipts сохраняются в browser storage
до однозначного завершения. То же правило применяется к `COMPETITOR_SERP`.

Оценка содержит:

- число ключей;
- число запросов к provider;
- ожидаемое время;
- цена;
- источник оплаты;
- доступный баланс;
- fallback max cost;
- данные, которые будут сохранены.

Scope materializer работает с каноническими keyword ID, а не с членствами в
папках. Если один запрос добавлен в несколько групп, rank/frequency manifest
содержит его один раз, provider получает один запрос, а сохранённый snapshot
автоматически виден во всех групповых проекциях этого keyword ID. Это исключает
двойной расход и не требует fan-out копий результата.

Канонический `keywords.is_tracked` по умолчанию равен `true`. Новый rank scope
отбрасывает запросы с `isTracked = false` до estimate, manifest и расчёта
стоимости. В мастере есть явный переключатель «Снимать позиции по
неотслеживаемым запросам»; его значение фиксируется в immutable launch profile
как `includeUntracked`. Tracking-context assignment задаёт сохранённый состав,
но не изменяет `isTracked`. Retry уже запечатанного manifest повторяет его
исходный scope и не перечитывает текущий переключатель.

### 3.1. Manual BYOK slice Arsenkin

По ADR-2026-034 и ADR-2026-043 legacy execution slice использует Arsenkin
`positions`. Новые estimate для обычного снятия позиций используют
документированный `check-top` с `is_snippet=true`: из одной выдачи вычисляется
позиция домена проекта и сохраняется полный SERP с title/snippet. Оба пути
проходят provider contract, entitlement, credential freshness и compatibility
gates.
Context, assignment, binding, estimate и compatibility UI не делают сетевой
запрос; live submit выполняет только isolated connector-worker под новой
kill-switch generation.

Исполняемый scope поддерживает Google Live Desktop/Mobile с глубиной TOP-30,
TOP-50 или TOP-100 и Яндекс Search API/Live с канонической внутренней
глубиной TOP-30, одним context на provider task и пакетами до 5 000 keywords.
Для новых запусков выбранная глубина передаётся `check-top`; Яндекс
TOP-50/TOP-100 блокируется на estimate. Adapter отображает профили в
зафиксированные Arsenkin search types: Яндекс Search API — `1`, Яндекс Live Desktop/Mobile — `2/3`, Google
Live Desktop/Mobile — `11/12`; регион передаётся только как проверенный
числовой provider ID. Выбранный `SEARCH_API`/`LIVE` является частью immutable
estimate и не может быть заменён при запуске. Raw SERP и platform-paid route
в этот slice не входят; fallback выполняется только через явно настроенный
connector route.
Каждый sealed provider task является одним provider batch: connector вызывает
Arsenkin `set` ровно один раз с массивом `queries` до 5 000 элементов, затем
poll-ит один task ID и нормализует весь task. Делить task на последовательные
paid submit по одному keyword запрещено.
Country, language, safe search и domain rule запрещено молча отбрасывать:
непредставимый context получает compatibility blocker ещё в estimate.

`POST /rank-estimates` не вызывает provider и возвращает versioned scope hash,
configuration versions, credential freshness, provider limits, BYOK allowance
`UNLIMITED`, expiry и `executionAllowed`. `POST /rank-runs` требует актуальный estimate,
`ranking.run`, CSRF и idempotency key; будущий provider submit этого run
дополнительно требует authoritative execution grant.

### 3.1.1. Обычная выдача конкурентов

Ручной конкурентный workflow переиспользует estimate/run/manifest pipeline, но
фиксирует в immutable execution `purpose=COMPETITOR_SERP`. Arsenkin connector
вместо `positions` вызывает документированный `check-top`: один batch содержит
массив запросов, один выбранный поисковик и регион, выбранный
`depth=10|20|30|50|100`,
`is_snippet=true`, `noreask=false`. Зафиксированные mapping versions
`arsenkin-check-top-yandex-xml@1`, `arsenkin-check-top-yandex-live@1` и
`arsenkin-check-top-google-live@1` однозначно отображают source/device в типы
`1|2|3|11|12`. XMLStock использует существующие Yandex Search API, Yandex Live
и Google Live connectors и запрашивает ту же явно выбранную глубину до Топ-100.

Оба варианта нормализуют и сохраняют упорядоченные `rank_serp_results` с URL и
доступными title/snippet для каждого keyword. Флаг `saveProjectPosition`
допустим только при `COMPETITOR_SERP`. При `true` connector ищет домен проекта
в уже полученной выдаче по зафиксированному `domainMatchRule`; найденная строка
становится обычным found snapshot. При `false` либо отсутствии сайта snapshot
всё равно сохраняет конкурентную выдачу, но получает
`position_tracking_enabled=false` и не меняет `current_ranks`, историю,
позиционные графики и экспорт истории. Отдельного provider request для позиции
нет. Additive migration
`20260902163000_competitor_position_tracking_policy` добавляет этот projection
gate к `rank_snapshots` и `ai_answer_snapshots`; старые снимки сохраняют
значение `true`. Migration
`20260902194500_competitor_rank_estimate_counts` обновляет CHECK оценки:
Legacy XMLStock Live receipts при конкурентном purpose сохраняют прежний
расчёт Топ-10; новые запуски передают и тарифицируют выбранную глубину;
для обычного снятия позиций ограничение по-прежнему использует полную глубину.

### 3.2. Реализованный provider-free estimate

Первый реализованный estimate принимает ровно один `trackingContextId`,
требует `ranking.view`, browser session, CSRF и `Idempotency-Key`. Он остаётся
доступным в billing read-only и для архивного проекта: такие состояния
возвращаются как blockers будущего запуска, а не скрывают уже сохранённые
настройки.

Поток не создаёт Job/JobItem, не ставит сообщение в BullMQ, не расшифровывает
credential, не вызывает Arsenkin и не создаёт domain event:

1. Platform API загружает актуальные project/workspace snapshot, currency и
   проекцию наличия `ranking.run`; browser не задаёт tenant, provider,
   credential, домен, quota или lifecycle.
2. Jobs/integrations по internal HTTP запрашивает у SEO Data атомарный scope.
3. SEO Data в `RepeatableRead` читает context, последнюю immutable
   configuration и до 15 001 активного temporal assignment. Для допустимого
   scope рассчитывается domain-separated SHA-256; keyword ID/text наружу не
   возвращаются.
4. Jobs/integrations в собственной `RepeatableRead` транзакции читает только
   allowlisted binding/route/credential metadata и доказательство validation
   текущего material, рассчитывает blockers и записывает immutable
   пяти­минутный receipt.

Значение `15001` является bounded sentinel «не менее 15 001», а не точным
count; hash такого неполного множества имеет состояние `UNAVAILABLE`.
Bounded scope `1..15000` также возвращает `UNAVAILABLE`, если keyword text
нарушает provider character/UTF-8/total-byte preflight; пустой scope всегда
hashable. Final
scope hash включает semantic scope, project domain/version и версии
binding/credential/validation/policy, но публичный ответ не раскрывает эти
идентификаторы.

До прохождения ADR-2026-034 каждый receipt содержит
`PROVIDER_CONTRACT_NOT_READY` и `PROVIDER_EXECUTION_DISABLED`;
`executionAllowed=false`. Provider limits и ожидаемая длительность возвращают
честный `NOT_AVAILABLE`, пока нет авторитетного versioned источника.
Разрешённый BYOK execution возвращает quota status `UNLIMITED`; для BYOK
platform charge равен нулю,
нормализованная история и ограниченная проекция organic SERP предназначены
для долгого хранения; raw provider response не собирается.

После начала provider `set` неоднозначный timeout/crash/`5xx` переводит item в
`SUBMIT_OUTCOME_UNKNOWN`. Автоматический повтор submit запрещён, пока provider
не предоставляет доказуемую идемпотентность или способ восстановить task ID.
Пользователь может создать только осознанный новый запуск с предупреждением о
возможном повторном списании внешних лимитов.

### 3.3. Зафиксированные execution-контракты

Exact contracts ручного запуска фиксируют: public command принимает только
`estimateId`; Job projection использует конечную матрицу status/stage; SEO
Data boundary разделяет immutable manifest, bounded chunks, normalized
found/not-found ingest и terminal finalize. Manifest seal/chunk runtime уже
реализован с immutable DB state machine и content-only active dedup.
Integrity hashes покрывают полный versioned RFC 8785 JCS preimage. Jobs
preparation/cancel и public Job lifecycle, а также SEO Data normalized
ingest/finalize/current/internal history реализованы. Jobs теперь также
атомарно связывает `CONSUMED` grant с единственной secret-free
`rank_connector_executions/READY_TO_SUBMIT`. До grant rank-worker дважды
проверяет locked Job/Run/Item graph вокруг dedicated-auth чтения exact sealed
chunk и сохраняет единственный append-only
`rank_provider_request_intents` snapshot. Snapshot содержит private keyword
text, но не credential identity/material; grant evidence v2 и составной FK
связывают его ID, request hash и manifest/chunk hashes с execution. Exact
replay снова проверяет authoritative SEO Data chunk, поэтому self-consistent
локальная подмена не принимается.

`SECURITY DEFINER` claim под canonical locks повторно проверяет current graph
и переводит ровно одну строку в pre-network `CLAIMED`, возвращая только scoped
encrypted credential projection. `PUBLIC` execute отозван, а authorize
повторно проверяет graph/lease/control fence и атомарно фиксирует
`SUBMITTING` до возможных network bytes. Isolated connector-worker затем
отправляет для новых estimate documented Arsenkin `check-top`, durable хранит exact wire
snapshot/hash и task ID, опрашивает `check` и вызывает `get` только после
`TASK_STATUS/finish` с progress 100. Provider adapter канонизирует обе
допустимые формы progress — JSON number и числовую строку
с необязательным `%`. Состояния `queue`, `queued`, `wait`, `waiting` и
`pending` означают, что уже принятая задача ждёт provider slot, и продолжают
polling без повторного submit; progress в этом состоянии может ещё отсутствовать.
Остальные значения и противоречивые status/progress комбинации остаются
fail-closed. Финальный `check-top` ответ нормализуется из
упорядоченных `collect` и `snippets`. Adapter принимает две однозначные формы,
зафиксированные provider-ответами: `searchEngine -> query -> URL[]` и
`query -> searchEngine -> URL[]`; во второй форме для текущего запроса строго
требуется один поисковик. Домен проекта ищется в диапазоне
1..sealed depth. Legacy `format=0` ответы продолжают читаться из
`result.table`, где `position=[1001]` означает not-found.
Сохраняется только normalized found/not-found output без raw provider body.
Premature `get`, неполный/лишний query set и неизвестные row layouts
завершаются fail-closed.

Platform API issuer принимает exact Jobs request без
binding/credential IDs, повторно проверяет owned lifecycle/RBAC state и
сохраняет immutable 30-секундный decision receipt с exact replay. Production
policy не считает и не ограничивает BYOK provider tasks по дням. Существующая
`rank_execution_quota_reservations` row создаётся как immutable usage/grant
binding для совместимости и аудита, но не участвует в admission decision. Jobs bounded
client сохраняет durable `REQUESTED`
до HTTP, делает exact replay и по часам `jobs_db` фиксирует
`DENIED`/`EXPIRED`/`GRANTED_PENDING_CONSUME`/`REJECTED_LOCAL`; валидное
положительное решение под повторной проверкой graph в той же post-issuer
транзакции атомарно создаёт secret-free scoped execution и становится
`CONSUMED`. Старые `GRANTED_PENDING_CONSUME` восстанавливаются отдельным
идемпотентным проходом. Dispatcher вызывает
service по одному sealed chunk. Использованные kill-switch versions immutable
и не переиспользуются; runtime activation выдаётся только новой generation
`arsenkin-positions@4`. Connector permission allowlist содержит только exact
claim/authorize/runtime broker execute и не выдаёт table DML.
Перед чтением transaction replay issuer берёт `pg_advisory_xact_lock` по
точному `workspaceId + jobItemId + executionAttempt`. Ожидающий конкурент в
`READ COMMITTED` видит уже сохранённый receipt и не повторяет INSERT в
`rank_execution_quota_reservations`; это исключает unique-conflict retry storm
при нескольких rank coordinators. Штатный runtime запускает один coordinator,
а provider connector pool масштабируется независимо.

Каждый HTTP-запрос к Arsenkin (`set`, `check`, `get` и credential `info`)
получает разрешение через общий для всех connector workflows и replicas
Redis sliding-window limiter: не более 30 запросов за 60 секунд. Limiter
fail-closed при недоступности Redis и не подменяется ограничением числа
BullMQ jobs; worker concurrency остаётся независимой настройкой. Rank request
timeout ограничен 10 секундами независимо от более широкого timeout credential
validation, а claim lease рассчитывается для двух последовательных request с
запасом и остаётся в broker-bound диапазоне 5–25 секунд. DB-bound ограничение
пяти одновременных provider tasks покрывает общий Arsenkin rank/Wordstat
lifecycle.

XMLStock использует отдельный distributed limiter по
`physical key + product`: Yandex Live, Yandex Turbo, Google XML (`GOOGLE_LIVE`), Yandex Search API и
Wordstat имеют независимые bounded concurrency/RPS buckets. Поэтому разные
BYOK-ключи не блокируют друг друга, одинаковый ключ в разных workspace
делит один bucket, а один ключ корректно делит provider
capacity между всеми своими проектами и connector replicas. Permit занимает
только реальный внешний HTTP-вызов; `POLL_WAIT`, локальный submit Live и
внутренние DB/SEO Data операции его не удерживают. Коды provider throttling
понижают окно и включают cooldown, а серия успешных ответов постепенно
восстанавливает базовую ёмкость. Redis остаётся только transient capacity
coordination и работает fail-closed; Job/lease/progress source of truth —
PostgreSQL. Базовые окна одного физического ключа: Yandex Live — `20 concurrent /
10 RPS`, Turbo — `50 / 50`, Google XML — `15 / 30`, Yandex Search API — `50 / 50`, Wordstat —
`10 / 10`. Сверху действует отдельный общий предел 64 внешних XMLStock HTTP-вызовов.
Односекундный предел сглаживается общими для replicas окнами по
100 мс, поэтому заявленная скорость не превращается в отклоняемый burst.
XMLStock не использует общий lifecycle limit из пяти задач:
dispatcher может подготовить новые keyword chunks только в пределах свободной
части общего пула из 64 connector rank lanes, после чего Redis и per-product limiter
задают фактический предел внешних HTTP-вызовов. Лимит пяти provider tasks
остаётся только у Arsenkin.
Штатные два connector process используют независимые deterministic dispatch
shards, по 32 rank slot и по пять frequency worker slot. Каждый slot имеет
фиксированный BullMQ lane ID; waiting/active backlog поэтому ограничен числом
lanes даже при остановленном consumer. Старый time-based tick после обновления
завершается без DB claim. Пул заполняется до 64 rank-вызовов, а Wordstat bucket
— до `10 RPS` на физический ключ. Ожидание permit не
расходует попытку JobItem и отображается как фаза выполнения с расчётным
числом provider requests, а не как terminal/error state.

Для XMLStock rank submit один fairness-поиск возвращает не более 30
candidate execution ID; connector process держит только эти ID в памяти не
дольше пяти секунд и распределяет их между свободными lanes. Каждый ID перед
платным запросом проходит targeted claim по primary key с прежними полными
tenant/credential/route/grant/lease проверками и атомарным переходом в
`CLAIMED`. Кандидатный список не является резервом; после падения процесса
другой worker может занять ещё не claimed executions. Claims одного Job
локально сериализуются из-за canonical lock родительского Job, а число
одновременных тяжёлых claims ограничено четырьмя на процесс. Внутри targeted
claim предварительно читается только один execution по primary key с проверкой
срока grant и версии коннектора; после него Job блокируется отдельным точным
tenant-scoped запросом. Все дочерние строки и актуальный Job затем повторно
проверяются под блокировками в прежнем порядке. Так многотабличный JOIN не
планируется на каждый ключ перед claim. Отозванный
кандидат пропускается без HTTP; Redis не хранит API-ключи или состояние Job.

XMLStock Яндекс Live Turbo не использует standard Yandex Live bucket: запрос
явно получает `tbm=turbo&groupby=50` и отдельный distributed quota bucket;
общий XMLStock HTTP ceiling и worker concurrency также сохраняются. Turbo не занимает
консервативное окно пяти активных provider tasks и исключается из подсчёта
этого окна для стандартных запусков. Обычный Live явно передаёт пустой `tbm`,
поэтому настройка Turbo в кабинете XMLStock не включает повышенный тариф
скрытно. Provider pending code `202` в Turbo повторяется через 15 секунд;
остальные adaptive cooldown правила стандартного Live не меняются.
Turbo запрашивает page width 50: TOP-50 обычно выполняет один GET, TOP-100 —
два. Если provider вернул только 10/20/30/40 документов, checkpoint сохраняет
фактическую ширину и connector дочитывает соответственно 5…2 либо 10…3 страниц.
Каждый checkpoint сохраняет весь нормализованный SERP с конкурентами. Для
позиционного XMLStock запуска immutable `xmlStockDepthMode` равен
`STRICT_DEPTH` либо `STOP_AFTER_FOUND`; второй режим завершает обход после
первой страницы, на которой найден домен проекта, а estimate показывает
нижнюю и верхнюю стоимость.

Rank connector dispatcher держит один idle probe на shard и наращивает
число rank lanes по фактической работе и ожидающим HTTP. Отказы Redis
capacity и пустые claims уменьшают число probes до необходимого уровня;
configured concurrency остаётся только потолком. Завершённые runtime
ticks удаляются сразу; Redis Jobs использует `maxmemory 1gb`, `noeviction` и
container limit `1536M`. Submit fast paths
проверяют актуальный parent Job до полного tenant graph и, для Arsenkin, до
provider-wide advisory lock; terminal Job с ещё действующим execution grant не
создаёт горячий цикл PostgreSQL. Poll fast path использует индекс
`connector version + status + next action/lease`, проверяет RUNNING parent Job
и лишь затем открывает credential/control graph. Для активного poll отдельный
индекс `job + connector version + status + due time` исключает повторное чтение
всей append-only истории executions текущего Job на каждом worker lane.
Poll claim считает живые `FETCHING` leases одной materialized агрегацией на
проход; коррелированный `COUNT(*)` для каждой из тысяч ожидающих страниц
запрещён. XMLStock берёт до 30 ID ожидающих страниц за один выборочный SQL,
но каждая страница отдельно получает полный атомарный targeted lease перед
HTTP; ID не является резервом и после сбоя снова доступен. Пустые poll claims одного connector process объединяются и
повторяются не чаще чем через 500 мс; положительный claim и lease не
кешируются. Rank grant dispatcher также
сериализует общий connector budget: для XMLStock 30-секундный grant buffer
ограничен одним окном connector lanes (64 в production), а не числом lanes,
умноженным на dispatch interval. Новый grant делится между активными XMLStock
Jobs и не расходуется на уже отправленные страницы в `POLL_WAIT`. Для
восстановления голодающего Job допускается ограниченный резерв до четверти
окна, но нельзя бесконечно занимать долю другого активного Job.
Для BYOK XMLStock выбор кандидата и fenced submit claim используют
17-секундный lease вместо 23-секундного платного lease: грант действует 30
секунд, а один provider HTTP-запрос ограничен 10 секундами. Системный
оплачиваемый ключ сохраняет запас на hold/capture. Внутри fairness-очереди
каждого Job свежие неподанные grants выбираются прежде почти истёкших.
Targeted claim одного execution ID не выполняет повторный `COUNT(*)`
активных executions для сортировки: это не меняет выбор и неоправданно
нагружает PostgreSQL при большом append-only журнале. Exact execution
материализуется по primary key до полного graph join; lock и permission
fences остаются прежними. Пакетный поиск submit-кандидатов не делает
дополнительный `NOT EXISTS` по тому же журналу перед основным query.
Неиспользованная авторизация допускается к повтору только спустя минуту после
expiry. Для выбранного Job dispatcher проверяет граф агрегатами и читает только
очередной bounded slice через latest-attempt lateral lookup, не материализуя
всю append-only историю executions в памяти worker. Готовые результаты
закрепляются set-based claim пачкой до 16 с отдельным lease каждой строки;
XMLStock ingest сохраняет эту пачку в одной Core-транзакции.

### 3.4. Реализованный read slice истории

SEO Data принимает exact normalized result chunks через отдельный
`JOBS_TO_SEO_RANK_RESULT_TOKEN`, строит append-only snapshots/current
projection, атомарно finalizes successful/partial manifest и пишет redacted
completion outbox. Внутренний history read использует tenant/filter-bound
HMAC cursor под отдельным `RANK_HISTORY_CURSOR_KEY`. Текущий Compose требует
оба secret и передаёт result token только `seo-data` и isolated
`rank-worker`; producer повторно проверяет staged hash и exact ingest receipt
до terminal Job/manifest finalization.

Public Platform API предоставляет
`GET /api/v1/projects/:projectId/rank-history`. Route требует browser session,
`ranking.view` и проверенный tenant scope; чтение разрешено для архивного
проекта и billing read-only workspace. Query принимает canonical UTC
`observedFrom` включительно и `observedBefore` исключительно, optional UUIDv7
`trackingContextId`/`keywordId`, limit `1..200` с default `100` и opaque
base64url cursor. Array/unknown parameters и некогерентный диапазон
отклоняются. Platform API fail-closed проверяет scope, фильтры, диапазон,
порядок, дубликаты и pagination coherence ответа SEO Data, redact-ит private
поля и возвращает collection `data + page + meta`.

Каталог `keyword-ranks/dimensions` использует устойчивую идентичность
`searchEngine|country|region|language|device` и отдельно возвращает
`dimensions` с SEO-снимками и `aiDimensions` со снимками ИИ-позиций. Body-only
comparison для явно открытых inspector/history принимает до 1000 keyword ID,
до 24 срезов и не более 2000 ячеек за запрос. Основная таблица comparison route
не вызывает: тот же body-only keyword list принимает exact visible rank column
keys, вычисляет их после cursor pagination и вкладывает найденные значения и
resolved-отсутствия в каждую строку. List также получает metric projection и не
читает frequency, legacy position, AI или SERP таблицы для скрытых колонок;
query-индикатор не расширяет серверную проекцию. Merge graph загружается один раз на list/comparison request, а
dimension reads выполняются параллельно с пределом четыре. Таблица загружает
все строки выбранной страницы одним request, а layout drawer создаёт для среза отдельные колонки
позиции, URL и времени. Открытие и закрытие layout
drawer не входит в revision key каталога или comparison и не очищает данные;
при явном refresh текущие ячейки остаются до атомарной замены новым ответом.
Позиция и время каждого среза поддерживают server-side sort по точному
dimension key до cursor pagination; направление и ключ сохраняются вместе с
видом и передаются в export snapshot. Динамические и обычные колонки используют
одни компоненты позиции, URL и даты: одинаковую жирность и дельту, фиолетовый
кликабельный URL максимум в две строки и единый формат времени.
Карточка запроса сохраняет
выбранный dimension при чтении графика, полного журнала и `mode=SERP`;
последний режим возвращает до 100 сохранённых organic results конкретного
immutable snapshot с городом, устройством, depth и provider provenance.
Provider request ID, credential и raw payload в Web не передаются.

Result workspace получает `counts.foundCount/notFoundCount` по полному
immutable manifest отдельно от cursor-страницы строк. Пока задание выполняется,
число ошибок выводится как завершённый progress минус сохранённые found и
not-found; после terminal состояния источником становится sealed Jobs receipt.
Счётчики верхней панели поэтому отражают все ключи задания при любом размере
страницы.

Новый `manual-xmlstock-serp@2.0.0` принимается каждым этапом estimate → manifest
→ provider intent → execution grant. Сценарий города × устройства сначала
готовит все оценки и только после подтверждения создаёт отдельные идемпотентные
Jobs. Локальный отказ intent сохраняет статический диагностический detail без
keyword, credential и provider payload, чтобы policy drift не превращался в
неразличимый `INTERNAL_ERROR` в служебных логах.
Если immutable manifest command содержит `providerPolicyVersion`, provider
intent обязан принять это allowlisted поле и проверить точное равенство policy
оценки; неизвестное либо несовпадающее значение отклоняется до provider bytes.
Platform quota reservation constraint перечисляет те же пять immutable policy:
три исторических и новые Arsenkin `@3.0.0`/XMLStock `@2.0.0`. Расширение
выполняется заменой и `VALIDATE` check constraint под блокировкой таблицы, без
изменения существующих reservation/grant receipts.

Семантическая таблица показывает для Яндекса и Google текущую позицию,
отдельный URL из съёма и дату последнего съёма. Обе URL-колонки включены в
стандартное представление и обычный экспорт. URL-ячейки показывают только
кликабельный адрес без дополнительной подписи о совпадении: проверка target URL
после безопасной нормализации host/path остаётся источником отдельного
индикатора у запроса и предупреждения в карточке. `observedAt` заполняется и для
нормализованного `not-found`: в этом случае позиция и URL отображаются красным
крестом, а дата остаётся доступной. Подпись «Была N» выводится только когда
непосредственно предыдущий позиционный snapshot того же точного среза содержал
найденную позицию. После двух последовательных `not-found` остаётся обычный
крест без старого значения. Найденная позиция сопровождается дельтой только
относительно непосредственно предыдущего snapshot этого же среза; после
пропуска она считается новым появлением.

Сортировка обычных и ИИ-позиций выполняется сервером до cursor pagination и
сохраняет четыре уровня при обоих направлениях: текущая найденная позиция,
потеря относительно непосредственно предыдущего съёма, измеренный `not-found`
после ещё одного `not-found`, затем запросы без позиционных снимков. ASC/DESC
меняет порядок чисел внутри первых двух уровней, но не порядок уровней.

Обычные engine-level колонки позиции, URL и даты берутся из одного самого
нового current snapshot данного поисковика среди всех его городов и устройств;
UI передаёт вместе с проекцией точный dimension и показывает его в подробностях
и tooltip. Для сравнения конкретных городов пользователь включает отдельные
dimension-колонки. Keyword insights проецирует для каждой исторической точки
только безопасные параметры воспроизводимости:
search engine/source, provider, region label/code, country, language, device,
depth, context name и `observedAt`; provider request ID и raw response в
browser не выдаются. Последний XMLStock или Arsenkin snapshot каждого
поисковика с сохранённым SERP дополнен tenant-scoped Top-10 organic projection
с позицией, URL и доступными title/snippet/favicon URL; в обычной карточке
видны первые пять строк, домен проекта выделяется заливкой без текстового
бейджа, favicon находится под номером позиции, а URL занимает не более двух
строк. Frontend сначала запрашивает корневой `/favicon.ico` домена результата,
использует сохранённый provider favicon как запасной источник и только затем
показывает локальную заглушку. Назначенный target URL сравнивается по
нормализованным host/path с последним ranking URL каждого точного среза
поисковика, региона, языка и устройства. Для индикатора достаточно
несовпадения хотя бы в одном срезе; более свежий корректный URL другого среза
не имеет права скрывать предупреждение. Target URL при этом остаётся
неизменным. Semantic list дополнительно получает только результаты своего
project domain из последнего snapshot каждого точного среза с позицией и
доступными title/snippet: несовпадение target
URL отмечается оранжевым индикатором, а несколько страниц проекта — кнопкой,
которая открывает в modal только страницы проекта как SERP-карточки с
позицией, favicon, title, description и URL; конкурентский Top-10 остаётся
отдельным блоком карточки запроса и в этот modal не подмешивается. Эти два
состояния независимы: если у запроса одновременно есть нецелевой URL и хотя бы
один текущий точный срез с несколькими страницами проекта, рядом с запросом
видны обе иконки и каждая открывает свой режим modal. Старые configuration
versions того же среза не участвуют: для каждого dimension используется только
самый новый допустимый snapshot после правил удаления и объединения срезов.
Визуальный текст всех SERP-ссылок не содержит транспортный префикс
`http://`/`https://`; полный безопасный URL сохраняется в `href` и tooltip.
Незашифрованный исходный `http://` отмечается рядом с URL небольшим оранжевым
открытым замком, для `https://` индикатор не выводится.
Заголовки Top-конкурентов, полного SERP-журнала и modal страниц проекта
показывают логотип поисковика, город и бейдж ПК/телефона. Тот же безопасный
контекст выводится в карточках rank-операций. Если старый snapshot содержит
только числовой provider region ID либо ошибочно сохранил его как label, Web
восстанавливает текстовое название из каталога; числовой ID не выводится в
пользовательских подписях и селектах, а экспортная колонка `Город` использует
тот же resolver. Отдельное поле `Код региона` остаётся машинным идентификатором
для повторного импорта и API. Текст результатов увеличен, а все
SERP-ссылки используют единый фиолетовый цвет.

Проектный график TOP-3/5/10/30/50 по умолчанию объединяет все замеры одного
UTC-дня и оставляет последний snapshot каждого keyword. Searchable selector
может ограничить ту же дневную агрегацию одним точным сочетанием поисковика,
города, языка выдачи и устройства; повторные съёмы этого сочетания в один день
по-прежнему образуют одну точку.
График карточки запроса показывает 14 последних immutable snapshots самого
keyword ID по времени, объединяя технические контексты и их версии; создание
нового контекста не скрывает более ранние замеры. Пять последних сгруппированных
дат показываются под графиком. Кнопка `История` открывает полный журнал этого
keyword ID через публичный history endpoint и opaque cursor по 200 snapshots,
независимо от tracking context; каждая строка показывает время, provider,
позицию, ranking URL и доступные title/snippet. Ответ истории дополнительно
содержит все страницы домена проекта с доступными title/snippet для каждого
immutable snapshot. Если в конкретном съёме найдено несколько
страниц проекта, строка показывает групповой индикатор; он открывает вложенный
modal поверх истории только с этими страницами в SERP-представлении выбранного
съёма.

URL-колонки подключены к фактическому провайдерскому результату сквозным
контрактом, а не вычисляются в UI. Rank connector нормализует найденную страницу
в `rankingUrl`; trusted ingest сохраняет её в `rank_snapshots` и
`current_ranks`; Core SEO выдаёт последнюю проекцию как
`Keyword.positions[].rankingUrl`; Platform API строго валидирует и без
переименования передаёт это поле same-origin BFF. Таблица и потоковый
`SEMANTIC_EXPORT` читают одну и ту же проекцию, поэтому экспортированные URL
Яндекса/Google совпадают с показанными в строке. Для `not-found` значение
отсутствует и не синтезируется из target URL.

Колонки обычной позиции и даты участвуют в server-side sort, поэтому их
порядок сохраняется при cursor pagination и infinite scroll. Позиция, URL,
дата и фильтры каждого среза выбираются только из его точного сочетания
поисковика, страны, региона, языка и устройства. Изменение immutable
configuration version одного logical context для другого города или устройства
не перезаписывает `current_ranks` предыдущего среза и не влияет на его
сортировку. ИИ-позиция, ИИ URL и дата ИИ-съёма аналогично изолированы полями
`search_engine`, `region_code` и `device` самого `ai_answer_snapshot`.

### 3.2. Отдельный съём ИИ-ответов Arsenkin

ИИ-ответ не является обычным rank snapshot и запускается отдельной командой
`Проверить ИИ-ответы`. Один запуск выбирает Яндекс или Google, numeric region,
desktop/mobile, домен и до десяти brand-маркеров. Execution использует
документированный Arsenkin tool `ai-serp` с фазами `set/check/get`; каждый
keyword выбранной поисковой системы расходует два лимита Arsenkin. Оценка в UI
показывает этот расход до запуска.
Первый запуск для России использует Москву (`213` для Яндекса, `1011969` для
Google); затем Web восстанавливает последний успешно запущенный регион этого
проекта отдельно для каждого поисковика.

Режим «Собрать ИИ-выдачу» отправляет тот же `ai-serp`, но фиксирует
`purpose=COMPETITOR_SERP`. В modal нет отдельного поля домена: host берётся из
авторитетной карточки проекта, поскольку provider contract требует его даже
при конкурентном исследовании. `excludeSubdomains=false`, список brands пуст,
а ответ и упорядоченные sources сохраняются независимо от галочки. Если
`saveProjectPosition=true` и домен проекта найден среди sources, тот же snapshot
может обновить ИИ-позицию; при выключенной галочке либо отсутствии сайта его
`position_tracking_enabled=false`, поэтому позиционная проекция и история не
меняются. Второй вызов Arsenkin для позиции не выполняется. Эта галочка есть
только в конкурентном ИИ-modal и отсутствует в обычной проверке ИИ-ответов.

Команда materialize-ит точные `keywordId/version`, выполняется фоновым
`AI_ANSWER_COLLECTION` и разделяет общий per-credential Arsenkin provider-task
broker с позициями и Wordstat. Отмена, polling, retry и terminal status остаются
durable; browser не является источником истины. Provider response нормализуется
в answer-present, признак/позицию/URL домена, brand-found, текст ответа и
упорядоченные источники. Provider HTML разбирается внутри connector-а и
преобразуется в bounded Markdown; raw HTML, credential и служебный provider
payload в публичный API не выдаются.

Изолированная connector-role не читает и не меняет Jobs-таблицы напрямую.
Claim, продление lease, фиксация submit, defer/retry, quarantine, failure и
completion проходят через отдельные `SECURITY DEFINER` broker-функции. Каждый
переход повторно проверяет тип Job, provider route, credential, version, lease
owner и точный batch item ID; общий
`seo-platform:rank-dispatch:ARSENKIN` capacity lock берётся до submit во всех
инструментах, включая rank и Wordstat.

Core SEO хранит каждый результат append-only в `ai_answer_snapshots` и
`ai_answer_sources` с job ID, engine, region, device, host и `observedAt`.
Уникальность `(job, keyword, engine)` делает повторную доставку идемпотентной,
version fence не позволяет записать результат уже изменённого keyword.
Semantic list проецирует только последний snapshot отдельно для Яндекса и
Google: ИИ-позицию, URL найденной страницы проекта, наличие ответа и дату. В
таблице URL ИИ-выдачи находятся в двух отдельных видимых по умолчанию колонках,
сравниваются с целевой страницей по той же безопасной нормализации, что и
обычные ranking URL, но не выводят текстовый статус совпадения внутри ячейки и
доступны в обычном экспорте. Для каждого последнего снимка Core
SEO читает непосредственно предыдущий позиционный snapshot того же
keyword/engine, региона и устройства. Таблица показывает «Новая», рост,
падение, отсутствие изменений или «Была N» только для первой потери позиции.
Отдельная кнопка с AI-иконкой рядом с запросом не выводится: ИИ-ответ,
позиции и источники открываются из вкладок карточки и соответствующих колонок.
Индикаторы нескольких URL и несовпадения найденного URL с целевым задаются
массивом `queryIndicators` текущего сохранённого представления. Modal
ИИ-ответа остаётся только экраном просмотра и загружает
tenant-scoped полный снимок с форматированным ответом, источниками, позицией
сайта, регионом, устройством и временем. Цифровые ссылки Arsenkin вида
`\[1\]\[6\]` в тексте
рендерятся как кликабельные favicon/domain chips соответствующих сохранённых
источников, ведущие на полный URL страницы; неизвестные номера остаются
обычным текстом. Отсутствие AI-блока является валидным результатом, а не
ошибкой provider-а. ИИ-позиции и даты последнего ИИ-съёма поддерживают
server-side сортировку до cursor pagination, отдельно для Яндекса и Google.
Наличие текста ИИ-ответа не подменяет состояние позиционного замера: сохранённый
позиционный snapshot без ответа считается измеренным `not-found`, а полное
отсутствие позиционных snapshots остаётся отдельным последним уровнем.
Keyword insights без явного dimension отдают bounded проекцию до 240 последних
обычных rank-снимков, до 240 ИИ-позиционных снимков и последние снимки с
источниками для каждого точного сочетания поисковика, региона и устройства.
Sidebar независимо выбирает SEO- и ИИ-срезы во вкладках `Позиции` и `Выдача`,
строит график из 14 последних снимков выбранного среза и не показывает в
селекте измерения без данных соответствующего типа. Поэтому ИИ-источники,
собранные для другого города или устройства, не скрываются выбранным SEO-срезом.
Кнопка `История`
загружает полный tenant-scoped журнал keyset-страницами по 200 строк через
аутентифицированный opaque cursor. Последний снимок каждого точного
engine/region/device, в котором были источники, формирует отдельный
`Топ конкурентов ИИ`: позиция источника, title, description и URL; домен
проекта выделяется тем же безопасным presentation-компонентом, что и обычный
SERP.
Старое поле `keywords.show_ai_answer_button` временно сохраняется только для
совместимости rolling deployment и больше не является источником видимости UI.
Положительный provider-признак `answerPresent` также является валидным, когда
Arsenkin не вернул опциональные Markdown/source details: persistence не должна
отвергать уже оплаченный ответ только из-за отсутствия этих необязательных
полей. Для одиночного Google AI-запроса connector сохраняет URL из агрегата
`result.top.urls`, если строка ответа не содержит `sources`: такой top
однозначно относится к единственному ключу. Для пакетного ответа aggregate top
не разносится по нескольким ключам без per-row evidence. Проектный operation
result постранично соединяет Jobs-owned immutable
scope/status с tenant-scoped keyword label и точным SEO snapshot этого Job;
лог доступен во время выполнения и после terminal state, не раскрывает raw
provider payload и не выполняет повторный submit.
Purpose проходит через все trusted response boundaries без восстановления в
браузере. Для `POSITION_TRACKING` result modal показывает позицию и страницу
домена проекта. Для `COMPETITOR_SERP` тот же modal shell получает отдельный
заголовок с выбранной глубиной и разворачивает сохранённые
`rank_serp_results` в строки `запрос / место / URL конкурента / title /
description / время` до этой глубины. ИИ-конкуренты аналогично отображаются как
отдельная операция «ИИ-выдача конкурентов» со строками сохранённых
`ai_answer_sources`: позиция источника, URL, title, description и время.
Карточки операций проверки позиций, выдачи конкурентов, ИИ-ответов и
ИИ-выдачи конкурентов используют единый бейдж поисковика, города и устройства
из immutable operation scope.
В верхней полосе результата длинные тарифы, суммы и подписи переносятся на
несколько строк без ellipsis. Rank-результат отдельно показывает выбранное
подключение по названию и маске; при fallback доступна раскрываемая история
причин выбора и фактическое число provider HTTP-запросов по каждому
использованному подключению. Plaintext API-ключ, внутренние credential ID и
непроверенные provider payloads не возвращаются браузеру.
Обычный ИИ-operation result не запрашивает массив источников, поэтому его
таблица и размер ответа остаются прежними. Строки без результата и terminal
ошибки имеют отдельные честные состояния, а пустые позиционные колонки в
конкурентные таблицы не подмешиваются.

Private/noindex Web route
`/app/projects/:projectId/rankings` показывает UTC date range,
context/keyword filters, load-more, loading/empty/error/offline states и
явные archived/read-only пояснения. Сбор запускается только для
provider-compatible Google depth 30/50/100 или Яндекс с внутренней depth 30, numeric-region
конфигурации и свежего пользовательского Arsenkin BYOK credential;
неподдержанные safe-search,
canonical/mirror rules и нечисловой регион блокируются до provider call.

На общем `/app/rankings` desktop filter bar размещает выбор `SEO выдача / ИИ
выдача` в одной строке с точным срезом, папкой, периодом и сортировкой. Поля
имеют ограниченные ширины и переходят в адаптивную сетку только на узком
viewport. Сводка показателей использует компактную высоту; единая кнопка
`Статистика` раскрывает все три связанные проекции: среднюю позицию,
распределение по ТОПам и движение запросов.

## 4. Rank snapshot

Сохраняются:

- keyword ID;
- tracking context ID;
- capturedAt;
- provider;
- organic position;
- absolute/pixel position, если доступно;
- ranking URL;
- normalized ranking URL;
- title/snippet;
- result type;
- SERP features;
- top depth;
- found/not found;
- raw SERP reference;
- job ID;
- provider request ID;
- data quality flags.

Для XMLStock вместе с каждым snapshot сохраняются упорядоченные
нормализованные organic результаты того же provider response до фактической
глубины, но не более Top-100. Для Arsenkin сохраняются доступная в result
`top20` проекция и найденная страница проекта; title/snippet остаются
optional, если provider их не передал. Отдельный Arsenkin `check-top` сохраняет
тот же упорядоченный SERP до выбранной глубины и переданные провайдером
title/snippet. Это отдельные дочерние immutable строки,
связанные составным ключом snapshot; они записываются пакетно, не содержат
credential, provider request ID или raw XML/JSON и не переписывают
существующую историю. Провайдеры без доступной SERP-проекции поле не создают.

`not found` отличается от ошибки сбора.

## 5. Доменное сопоставление

Режимы:

- exact host;
- include `www`;
- include subdomains;
- canonical domain;
- any project mirror;
- specific URL;
- URL prefix;
- regex для административной настройки.

Редиректы и URL normalization должны быть настраиваемыми. Сопоставление хранит использованное правило.

## 6. Экран мониторинга позиций

### Summary

- visibility;
- average position;
- TOP-1/3/5/10/20/30/50/100;
- gained/lost;
- entered/exited TOP;
- not found;
- tracked count;
- data completeness.

### Controls

- search engine, region, device, language and depth configured at run time;
- period;
- comparison period;
- group/tag/view;
- provider;
- annotations;
- competitor overlay.

### Графики

- visibility;
- average position;
- TOP distribution;
- gains/losses;
- competitor share;
- SERP feature share;
- estimated traffic with transparent formula.

### Таблица

- keyword;
- group;
- frequency;
- positions for selected dates;
- delta;
- ranking URL;
- target URL;
- cannibalization;
- features;
- freshness;
- data quality.

Таблица мониторинга использует тот же grid contract, что семантика: набор
колонок отличается, но выделение, infinite scroll, сортировка, плотность и
перестановка колонок едины. Обязательны три Wordstat-колонки, текущая и
предыдущая позиция, а также отдельные ranking URL Яндекс и Google.

Tracking context остаётся внутренним immutable/versioned снимком параметров,
без которого нельзя воспроизвести историю. Пользователь не создаёт и не
выбирает его отдельно: при каждом ручном запуске одинаковое окно на страницах
семантики и позиций собирает параметры и атомарно создаёт техническую версию
профиля вместе с назначением выбранных запросов.
Загрузка необязательной истории предыдущих запусков не блокирует получение
актуальной workspace-маршрутизации: повреждённый legacy Job не должен скрывать
проверенный XMLStock/Arsenkin credential или запрещать новый запуск. Терминальный
`ACTION_REQUIRED` остаётся валидным, если до неизвестного submit outcome часть
чанков уже была сохранена; его persisted/failed/unknown counters обязаны вместе
соблюдать общий pair count.

## 7. Детальная история запроса

- line chart positions;
- ranking URL timeline;
- title/snippet changes;
- SERP snapshots;
- competitor positions;
- annotations;
- target URL mismatch;
- raw result access by permission.

Пользователь может сравнить любые два snapshots.

## 8. Visibility

Формула является конфигурируемой и версионируемой:

- CTR curve;
- frequency type;
- frequency fallback;
- position cap;
- weighting by priority;
- treatment of not found;
- branded exclusions.

Отчёт показывает версию формулы. При изменении формулы исторические данные либо пересчитываются отдельным job, либо показываются по версии.

## 9. SERP snapshot

Сохраняются:

- ordered organic results;
- URL, host, title, snippet;
- result type;
- special blocks;
- ads presence;
- local/maps;
- featured snippet;
- people also ask;
- images/video/news/shopping;
- AI overview/AI answer, если provider законно предоставляет;
- collection context;
- provider and raw reference.

Сырые ответы:

- сжимаются;
- хранятся в object storage;
- имеют checksum;
- доступны ограниченному кругу ролей;
- удаляются по retention policy.

## 10. Сравнение SERP

- изменения TOP;
- новые/выпавшие домены;
- URL transitions;
- изменение special features;
- коэффициент стабильности;
- overlap между запросами;
- compare regions/devices/engines;
- compare dates.

## 11. Wordstat и частотности

### 11.1. Типы операций

- top requests;
- dynamics;
- regions;
- базовая частотность;
- точная фраза;
- фиксированная словоформа;
- вложенные запросы;
- левая/правая колонка, если источник предоставляет;
- batch refresh существующих запросов.

### 11.2. Frequency snapshot

- keyword;
- value;
- match/operator type;
- region;
- device, если применимо;
- period;
- observedAt;
- provider;
- job;
- source credential type;
- quality flags.

Значения разных операторов и регионов не перезаписывают друг друга.
Пользователь может удалить из карточки запроса один полный контекст
type/region/device после отдельного подтверждения. Удаляются все snapshots
этого контекста для одного keyword; snapshots других операторов, регионов,
устройств и запросов не затрагиваются.

### 11.3. Wordstat job wizard

Диалог ручного сбора частотности повторяет трёхколоночную структуру остальных
операций семантики: подключение провайдера, параметры Wordstat и охват запроса.
Колонка охвата использует тот же cursor-paginated scope-picker, что съём
позиций, ИИ-ответов и кластеризация; footer с оценкой и запуском остаётся
закреплён независимо от прокрутки или изменённой высоты списка.

- seed/source;
- region;
- devices;
- operation type;
- depth/page limit;
- negative words;
- min/max frequency;
- duplicate handling;
- target group;
- estimate;
- schedule.

Для Arsenkin Wordstat один публичный Job принимает 1–10 000 keyword ID/version и
отправляет один `set` с массивом всех уникальных нормализованных query texts.
Сам Job и его 10 000 JobItems создаются атомарно; owner-side записи разбиваются
на SQL batches до 2 000 строк, чтобы public limit не зависел от PostgreSQL bind
parameter limit. Connector читает keyword ID/version пакетами до 1 000 и
сохраняет нормализованные snapshots пакетами до 500, продлевая fenced lease
между внутренними окнами. Эти chunks не создают дополнительные provider tasks.
Один opaque task ID сохраняется на каждом JobItem пакета; connector опрашивает
`check` и вызывает `get` только после статуса `finish`. Итоговый `get` обязан
вернуть однозначно привязанный результат для каждого query, после чего
все keyword snapshots сохраняются идемпотентно и JobItems завершаются одной
lease/version-fenced DB-командой. Missing, duplicate-conflicting или unknown
query rows отклоняются как invalid provider response. Уже существующие
per-keyword task ID опрашиваются без повторного submit. Неоднозначный transport
outcome submit не ретраится, чтобы не создать второй платный task. XMLStock
не объединяется и выполняется по одному keyword, сохраняя все выбранные типы.
Публичный XMLStock Job использует ту же platform boundary 1–10 000 keywords:
прежний предел 200 не является provider limit и не применяется. Это не меняет
wire contract — connector по-прежнему отправляет каждый keyword отдельным
request, соблюдая bounded quota выбранного XMLStock credential/product и
lease fencing.
Начальный Wordstat-регион wizard — Россия (`225`); после успешного запуска Web
восстанавливает последний регион этого проекта. Далее первыми показываются
Москва и Санкт-Петербург. Поиск региона съёма использует полный российский subtree
текущего каталога Яндекса и все российские location ID из каталога Google,
поддерживаемого connector route. Одинаковые названия дополняются родительской
областью/округом; в интерфейс не попадают зарубежные или непринимаемые текущим
провайдером коды.

XMLStock Wordstat следует provider contract `/wordstat/json/`: один внешний
request содержит один `query` и один `pagetype=words`. BASE использует запрос
без операторов, EXACT — запрос в кавычках, FIXED — запрос в кавычках с `!`
перед словами. `groupby` ограничивает число связанных фраз в provider answer и
не является batch входных keywords, поэтому объединять несколько ключей в
один такой request нельзя. Регион и устройство являются частью контекста
snapshot и ключа идемпотентности.

Для XMLStock rank один manifest chunk содержит один keyword. Яндекс Search API
работает асинхронно через `delayed=1`: connector сохраняет только `req_id`,
ждёт 15 секунд до первого poll и 25 секунд между pending ответами; коды
`202/210` означают ещё не готовый результат. Обычные Яндекс Live и Google Live
синхронны и при глубине TOP-10/30/50/100 планируют 1/3/5/10 страниц по 10
результатов. Неполная или расширенная страница не завершает strict-обход:
connector продолжает чтение до выбранной глубины и обрезает итоговый SERP по
Top. Turbo Яндекс Live запрашивает 50 результатов параметром `groupby=50` и
сохраняет фактически подтверждённые 10/20/30/40/50 в checkpoint
`xmlstock-rank-page@2`; TOP-50 занимает 1…5 GET, а TOP-100 — 2…10. Документы
сверх подтверждённой ширины страницы безопасно обрезаются до смещения
следующей страницы. Все найденные позиции переводятся в
абсолютный индекс; matching URL сохраняется как ranking/relevant URL, raw XML
отбрасывается после строгой нормализации. После успешного checkpoint следующая
Live-страница получает `next_action_at = now` и может сразу перейти свободному
worker; provider pending/retry остаётся отложенным и worker во время ожидания
не блокируется.
Первая страница обычного XMLStock Яндекс/Google Live запускается так же сразу
после локального submit. Стартовая пауза 15 секунд сохраняется только для
XMLStock Яндекс Search API с `delayed=true`.

Органическая проекция терпимо обрабатывает provider `<doc>` без URL: блок
учитывается в размере страницы и абсолютном смещении позиций, но не сохраняется
как кликабельный SERP result. Checkpoint допускает возрастающие позиции с
пропусками, поэтому остальные документы и следующие страницы не теряются.
Malformed XML, несовместимый сохранённый checkpoint или другая строгая ошибка
адаптера возвращается как terminal `INVALID_PROVIDER_RESPONSE`; execution
завершается в текущем lease и не занимает поток повторно до общего лимита в 50
попыток. Это не меняет 20 provider slots, Redis RPS/concurrency buckets или
немедленную постановку следующей успешно сохранённой Live-страницы.

Для XMLStock run доступен tenant-scoped live diagnostics read. Он показывает
ограниченный снимок последних keyword executions, доступный пользователю текст
ключа, номер строки, submit/poll attempts, page progress,
следующее действие и allowlisted error code. Физические worker ID, `req_id`,
credentials и raw provider responses не выдаются. Web опрашивает endpoint
только при открытой подмодалке «Логи XMLStock» и хранит не более 500
изменившихся записей локально. В модалке результата XMLStock-съёма, открытой
из сайдбара операций, явная кнопка «Логи» находится в header; для других
провайдеров она не отображается.
Показатель `active` означает число живых DB leases, включая ожидание Redis
permit, и в интерфейсе называется «Заданий в обработке». Он не именуется
числом HTTP-потоков; синтетическое `sequence % concurrency` не выдаётся за
физический поток. Лимит одновременных HTTP-запросов на один ключ показан
отдельно.
Private provider intent не открывается general Jobs runtime таблицей:
owner-owned tenant-scoped projection возвращает только текст ключа и
allowlisted execution-поля, а active-state вычисляет без физического имени
worker.

Один XMLStock keyword execution выполняет максимум 50 фактических provider
HTTP попыток. Capacity/quota deferral не считается попыткой; READY на 50-й
попытке разрешён, иначе item завершается `FAILED_FINAL` без 51-го запроса.
Terminal result projection возвращает status, pollAttempts и allowlisted
errorCode, а Web показывает такие keywords отдельным списком неснятых запросов.
Arsenkin batch polling сохраняет собственную более длинную task-level границу.

Источник выдачи является обязательной частью immutable estimate и request
snapshot. В первом контуре поддерживаются XMLStock Яндекс Search API, Яндекс
Live и Google Live, а также Arsenkin Яндекс Search API, Яндекс Live и Google
Live. Для XMLStock standard Яндекс/Google Live доступны TOP-10/30/50/100;
для Arsenkin Яндекс доступен TOP-30, для Google — TOP-30/50/100. Estimate
показывает расход в единицах провайдера: Arsenkin Google требует соответственно
2/3/5 лимитов на ключ, Яндекс — 2 лимита; XMLStock Search API выполняет один
request на ключ, standard Live — `ceil(depth / 10)` requests на ключ. Для
Яндекс Live Turbo strict estimate показывает диапазон
`ceil(depth / 50)…ceil(depth / 10)`. При `STOP_AFTER_FOUND` нижняя граница —
один запрос на ключ, верхняя совпадает с Turbo worst case; для стандартного
Live используется такая же граница 1…`ceil(depth/10)`.
Безопасная публичная проекция задания обязана сохранять признак Turbo, чтобы
списки операций, итоговое окно и live-логи не подписывали такой съём как
обычный Яндекс Live. Для старого задания признак восстанавливается только из
его immutable тарификационного снимка, без обращения к текущей настройке.
Запуск передаёт ровно выбранный
`credentialId` и не мутирует routing binding после estimate.
Перед внешним `set` connector после Redis permit атомарно резервирует один из
пяти общих для rank/Wordstat Arsenkin slots и записывает durable submit marker.
Если worker теряет подтверждение submit или перезапускается с marker без task
ID, Job остаётся в `ACTION_REQUIRED` до ручной сверки с провайдером; обычная
команда retry такой Job не переотправляет. Poll horizon для большого task — до
720 попыток с provider-controlled delay, а ожидание свободного slot не расходует
attempt.
Fenced lease frequency connector равен 120 секундам: это покрывает один
внутренний SEO Data timeout до 60 секунд и обязательный запас на запись;
между bounded resolve/persist окнами lease продлевается.
Одновременно пришедшие Arsenkin rank и Wordstat ticks сериализуют короткую
секцию резервирования provider slot общим transaction-scoped lock; Wordstat
ждёт её не более двух секунд, поэтому одинаковый scheduler bucket не вызывает
бесконечное `waiting_provider_capacity`. Для XMLStock эта общая DB-секция не
используется: rank и Wordstat получают permit из соответствующего bucket того
же credential, а локальное ожидание capacity не расходует provider attempt.

## 12. Search suggestions

Источники:

- Google;
- Яндекс;
- YouTube;
- дополнительные provider connectors.

Параметры:

- locale;
- country;
- alphabet expansion;
- prefix/suffix;
- question modifiers;
- depth;
- dedup;
- target group.

Сбор должен соответствовать правилам источника и использовать разрешённый connector.

## 13. Сбор ключей конкурентов

Проектная вкладка `Keys.so` использует BYOK connector и создаёт асинхронный
`KEYWORD_RESEARCH` run. Для домена и базы она получает нормализованные organic
keywords, URL, позицию и частотность, а также dashboard-метрики TOP-1/3/5/10/50,
видимость и bounded список конкурентов. Сырые provider-ответы и API token в
browser не передаются. Отсутствующий у Keys.so домен является конечной
provider-ошибкой, а не пустым успешным отчётом.

Результат сначала сохраняется в Jobs-owned staging preview. Пользователь
импортирует все строки или выбранные строки в существующую папку либо в новую
папку под выбранным parent. Import worker передаёт Core SEO bounded chunks по
500 запросов, применяет явную duplicate policy и сохраняет источник в тегах и
custom values. Выбранные Keys.so строки можно без копирования вручную передать
как seed-фразы в соседний мастер Wordstat.

Выбор «Все найденные» является server-side выражением над полным immutable
результатом run, а не списком строк текущей preview-страницы. Клиент передаёт
`selectionMode=ALL` и только ID явно снятых строк в `excludedRowIds`;
`selectionMode=SELECTED` передаёт только `selectedRowIds`. Поэтому infinite
scroll не меняет смысл выбора, а импорт полного результата не требует сначала
загрузить все строки в browser.

### 13.1. Расширение семантики Wordstat через Arsenkin и XMLStock

Мастер принимает до 500 уникальных seed-фраз из textarea, текущего выбора
запросов или папок проекта. Он фиксирует регион, устройство, минус-слова,
очистку минус-фраз/плюсов, включение правой колонки и лимит результата до
10 000 строк. Пользователь явно выбирает провайдера. Arsenkin connector
запускает документированный Wordstat tool `type=2` одним `set`, затем выполняет
`check/get` того же provider task. XMLStock connector выполняет отдельный GET
`/wordstat/json/` с `pagetype=words` для каждой seed-фразы и ограничивает
`groupby` официальным пределом 2 000. Поля `results` и `associations`
нормализуются в те же строки `LEFT|RIGHT` с исходной seed-фразой и
частотностью. Разные seed-фразы одного XMLStock run отправляются параллельно
в рамках общего лимита физического ключа. Fanout дополнительно ограничен
остатком `maxKeywords / 2000`: при текущем пределе результата 10 000 строк
первая пачка содержит максимум пять GET, чтобы не оплачивать лишние фразы.
Начальный регион обоих вариантов всегда Россия (`225`).

Run проходит состояния `QUEUED → RUNNING → READY_TO_IMPORT`; закрытие или
повторный poll не запускают платную задачу повторно. Если transport outcome
после начала `set` неизвестен, операция изолируется для ручного решения.
Provider task разделяет общий предел пяти активных Arsenkin tasks с позициями,
обычной частотностью, ИИ-ответами и кластеризацией. XMLStock запросы получают
отдельный per-physical-key `WORDSTAT` permit и fenced checkpoint каждого seed:
`STARTED` записывается перед HTTP, `ACCEPTED` сохраняет нормализованный
результат до публикации preview, а неопределённый оплаченный outcome
пропускается с предупреждением без повторной отправки; остальные seed-фразы
обрабатываются до конца. Готовые результаты применяются по
исходному порядку, включая восстановление после сбоя worker. Preview и импорт у обоих
провайдеров используют тот же выбор существующей/новой папки, что и Keys.so.
Импорт Wordstat не создаёт автоматические теги провайдера или источника:
происхождение остаётся в run metadata и custom values строки. После завершения
import-worker клиентский монитор операций перечитывает запросы, общий счётчик
и дерево папок без ручной перезагрузки страницы.

## 14. Проверка индексации

- single URL;
- sitemap;
- page list/filter;
- provider: Webmaster, Search Console URL Inspection, Arsenkin/XML provider;
- status;
- last crawl;
- canonical;
- robots;
- reason;
- checkedAt;
- provider.

Ограничения quota URL Inspection учитываются scheduler.

## 15. Универсальный экран «Сбор данных»

Карточки collectors:

- positions;
- SERP;
- Wordstat;
- suggestions;
- competitor keywords;
- indexing;
- clustering;
- analytics sync;
- crawl.

Каждая карточка показывает:

- доступные connectors;
- состояние credentials;
- последнюю задачу;
- стоимость;
- quick run;
- documentation.

## 16. Очередь и история

Колонки:

- job;
- project;
- type;
- source;
- scope;
- progress;
- stage;
- status;
- owner;
- created/start/end;
- cost estimate/actual;
- retries;
- actions.

Фильтры:

- workspace/project;
- type;
- provider;
- status;
- actor;
- schedule;
- period;
- paid/BYOK.

## 17. Job detail

- конфигурация;
- immutable input snapshot;
- этапы;
- progress;
- provider requests;
- rate limit;
- retry history;
- row/item errors;
- costs;
- reserved/charged/released amount;
- result links;
- logs safe for user;
- internal correlation IDs;
- cancel/retry/clone.

## 18. Data quality

Флаги:

- `COMPLETE`;
- `PARTIAL`;
- `CONTEXT_INCOMPLETE`;
- `PROVIDER_ERROR`;
- `PARSE_WARNING`;
- `STALE`;
- `FALLBACK_USED`;
- `MANUAL_IMPORT`;
- `OUTLIER`;
- `DUPLICATE_SNAPSHOT`.

UI не должен смешивать partial и complete data без обозначения.

## 19. Отказы и fallback

Fallback policy содержит:

- primary connector;
- ordered alternatives;
- retry policy primary;
- allowed error classes;
- max extra cost;
- max total cost;
- minimum balance;
- allowed credential types;
- notify conditions.

Fallback запрещён:

- если пользователь не дал согласие на системный paid key;
- если превышен budget;
- если контекст нельзя эквивалентно перенести;
- при authentication error пользовательского ключа без явной настройки;
- при юридическом ограничении региона.

Каждый fallback фиксируется в job и snapshot.

Явно выбранные в мастере provider и credential образуют первую попытку
конкретного запуска, даже если credential находится не в начале workspace
chain. При допустимой причине до внешнего submit fallback продолжает по
сохранённой цепочке без повторения выбранного credential. Для XMLStock rank
resolver до создания immutable estimate сравнивает текущий баланс с верхней
стоимостью всех запросов выбранной глубины и режима; недостаток баланса не
мешает сохранить или переставить сам route.

Обычная частотность и сезонность сохраняют выбранный `credentialId` при
изменении scope и не подменяют его в browser на первый аккаунт с достаточным
балансом. Недостаток баланса выбранного XMLStock определяется server-side по
полному верхнему числу запросов; только после этого применяется разрешённая
workspace fallback chain и фактический route фиксируется в Job snapshot.

Для XMLStock Wordstat `LOW_BALANCE` определяется до создания Job по полной
верхней стоимости `keywords × выбранные виды частотности` и сохранённой ставке
аккаунта. Resolver выбирает первый credential в workspace chain, чей денежный
баланс покрывает весь запуск. Поле XMLStock `requestLimit=0` у тарифа с оплатой
за запрос не трактуется как нулевая квота.

## 20. Частичные результаты

- Успешные элементы сохраняются.
- Ошибочные элементы имеют retryable/final classification.
- Повтор можно выполнить только для ошибок.
- После ручной отмены rank/frequency операция «Продолжить» создаёт новый
  immutable запуск только для строк без сохранённого результата; завершённые
  строки старой операции не открываются повторно.
- Для частичного ручного съёма позиций UI показывает действие «Дособрать
  позиции». Оно создаёт отдельный дочерний Job, а сервер материализует scope
  только из записей закрытого родительского manifest без сохранённого
  snapshot; клиент не передаёт список ключей.
- Итоговый статус: `PARTIALLY_COMPLETED`.
- Стоимость рассчитывается по фактически принятым provider операциям.
- Пользователь может экспортировать error items.

## 21. Периоды и сравнения

- current vs previous equal period;
- custom date;
- selected snapshots;
- same weekday;
- before/after annotation;
- year-over-year.

Если snapshots отсутствуют на точных датах, UI показывает фактически использованные даты.

Фоновый XLSX-отчёт истории позиций доступен из экспорта семантики отдельно от
обычной выгрузки таблицы. По умолчанию он исключает запросы с
`isTracked = false`, а отдельная явная опция включает их. Отчёт принимает
одну выбранную поисковую систему и ограниченный UTC-диапазон, читает
append-only BYOK/platform/manual history keyword ID через все tracking contexts
и сохраняет отдельную строку для каждого города и устройства. Язык keyword
хранится отдельно от языка выдачи. Фактические даты размещаются по убыванию.
Значения позиций записываются числами, `not-found` — прочерком, а отсутствие
замера — пустой ячейкой; строки TOP-5,
TOP-10 и TOP-30 используют Excel-формулы. Первое появление и улучшение
окрашиваются зелёным, ухудшение и переход из найденной позиции в `not-found` —
красным, неизменное значение — нейтральным. Нейтральный прочерк означает, что
позиции нет и в предыдущем фактическом замере; отсутствие snapshot в отдельную
календарную дату не приравнивается к `not-found`.

Export-only колонки конкурентов семантики читают те же append-only snapshots, но
для каждого keyword ID и точного географического среза используют только
последний доступный результат. В SERP-колонки попадают URL первых десяти результатов
XMLStock/Arsenkin вместе с сохранёнными title и description; в колонки
ИИ-конкурентов — URL источников последнего Arsenkin AI-answer snapshot и их
title/description. Источники можно выбирать независимо. Собственный домен
проекта исключается, а одинаковые нормализованные URL дедуплицируются внутри
одного keyword, источника и среза, не меняя построчную структуру обычного
экспорта семантики. Режим построчного экспорта конкурентов отдельно выводит
search engine, регион, устройство, SERP position, URL, title/description,
`observedAt` и provider, поэтому результаты разных городов не склеиваются.

## 22. Состояния модуля

- tracking not configured;
- integration missing;
- credential expired;
- collecting;
- scheduled;
- queued;
- rate limited;
- partial;
- completed;
- cancelled;
- insufficient balance;
- quota exceeded;
- no snapshots in period;
- context changed;
- stale;
- archived project.

## 23. Производительность и хранение

- Текущие позиции читаются из materialized/current table.
- История — append-only partitioned snapshots.
- Dashboard агрегаты предварительно вычисляются.
- Raw SERP не читается для обычного отчёта.
- Retention raw и parsed данных настраивается отдельно.
- Удаление старых partitions выполняется обслуживающим job.
- Parsed/aggregate rank history платного workspace хранится без фиксированного
  продуктового срока и остаётся доступной в billing read-only.
- Raw SERP, provider payload и HTML имеют `expiresAt` из plan snapshot;
  их удаление не удаляет position/frequency aggregates и provenance metadata.
- Нулевой баланс блокирует новый сбор, но не чтение существующей истории.

Фактический первый normalized slice пока хранит `rank_snapshots` без RANGE
partitioning. Partition maintenance/retention и representative history load
test не выполнены и остаются release gates, даже при готовом public read
API/UI.

## 24. Дневной отчёт позиций

`POST /projects/{projectId}/rank-workbench/positions` принимает режим
`SEO|AI` (старые клиенты без режима получают `SEO`), один точный dimension
key, период, папки, поиск, sort и bounded page. Core SEO выбирает последний
immutable rank- либо AI-answer snapshot каждого фактического UTC-дня съёма и возвращает
максимум 31 столбец. Дни без единого snapshot не добавляются; длинный диапазон
равномерно выбирает наблюдавшиеся дни, сохраняя первую и последнюю точки.
Столбцы идут от самого нового съёма слева к более старым справа.
Сводка и trend считаются по всему фильтру; строки выдаются по 50/100/200 без
загрузки 50 000 ключей в браузер. Пустая ячейка означает отсутствие съёма,
`×` — выполненный съём без позиции, цвет и delta сравнивают соседние доступные
дни. Фон снижения остаётся лишь слегка розовым, а более насыщенный красный фон
зарезервирован для состояния «не найдено». Найденная позиция открывает
сохранённый ranking URL. UI показывает
взаимоисключающие режимы `SEO выдача` и `ИИ выдача`, подставляет только срезы
соответствующего каталога и сохраняет режим и последний срез локально для
пользователя. История позиций, история выдачи и ссылка на поиск находятся у
запроса и открывают историю выбранного типа. Если ranking URL не
сохранён у `MANUAL_IMPORT`, позиция остаётся обычным числом без ссылки и весь
отчёт продолжает открываться; legacy internal response с явным `null`
нормализуется в отсутствие URL. Если ranking URL не
совпадает с целевым, ячейка показывает жёлтое действие «Нерелевантный URL»;
оно открывает только страницы домена из organic SERP именно этого immutable
snapshot, сохраняя исходную позицию каждого URL. Прямое открытие страниц
snapshot закрывается в матрицу и не оставляет под собой modal истории. Рабочая область
прокручивается внутри viewport, а modal истории обрезает edge-to-edge
содержимое по общему внешнему радиусу. Cursor-страницы автоматически добавляются
при приближении к концу таблицы. Фильтры и actions образуют две компактные
верхние строки. Управление видимостью дат перенесено туда же, счётчик запросов
около него и отдельная шапка «История позиций по дням» не выводятся. Все даты в
trigger периода, заголовках матрицы и списке колонок содержат год. Действия
ячейки стоят вертикально справа. Строка матрицы остаётся компактной: запрос
занимает одну строку с полным текстом в tooltip, а частотности и действия
запроса объединены в одну нижнюю строку; позиция и delta сохраняют читаемую
иерархию без дополнительной вертикальной высоты.
Общий календарь периода использует выбор одного дня первым кликом и диапазона
вторым, показывает доступную историю в header и быстрые пресеты на 1, 7, 30 и
90 дней. Текстовая секция «Период графика» и кликабельные поля отдельных
границ не выводятся.

## 25. Сравнение сохранённой выдачи

`POST /projects/{projectId}/rank-workbench/serp` принимает до пяти точных
dimensions и возвращает последние сохранённые XMLStock, Arsenkin и
Key Collector snapshots, а также ИИ-источники того же engine/region/device по
странице ключей. Все источники проходят один конечный canonical enum; frontend
не разбирает сырые значения `.kc4`. UI показывает
обычную и ИИ-выдачу в взаимоисключающих режимах: ИИ-источники не попадают в
обычный режим, а checkbox «ИИ-выдача» переключает таблицу и мастер сбора на
ИИ-конкурентов. Выбранные dimensions, папка и режим сохраняются в браузере с
ключом пользователя и проекта; недоступный после перезагрузки dimension или
удалённая папка безопасно заменяются доступным значением. Каждый результат сохраняет position, URL, favicon, title и
snippet. UI подсвечивает домен проекта, одинаковые домены во всей загруженной
матрице текущего режима — как между срезами одного ключа, так и между разными
ключами — и персональный список наблюдения. Уникальный домен не получает
автоматическую подсветку. Повторяющимся и добавленным вручную доменам
назначаются стабильные контрастные цвета без повторения в пределах доступной
палитры; одинаковые домены включаются персональным checkbox, а список наблюдения является presentation preference и
не меняет provider evidence. Кнопка сбора использует обычный
`COMPETITOR_SERP` wizard, поэтому новые данные остаются в общей семантике,
истории и экспорте. Экран полноширинный, использует компактную 48 px app-шапку
и flush-панель фильтров по геометрии экрана «Позиции», без повторного page heading и заголовка
«Результаты по запросам», с теми же боковыми полями, что экран позиций. Папка выбирается общим
иерархическим picker. Один выбранный dimension показывает до трёх карточек
ключей в строке desktop. Несколько dimensions показывают один ключ в строке и
распределяют все срезы по доступной ширине, с горизонтальной прокруткой только
когда минимальная читаемая ширина уже не помещается. В ячейке по умолчанию
виден Top-10, полный snapshot раскрывается явно, следующие страницы ключей
загружаются бесконечной прокруткой.

История SERP ключа может включать «Показать движение». При наличии минимум двух
snapshot текущий URL сравнивается с лучшей позицией того же домена в предыдущем съёме;
рядом с позицией показывается рост, падение, отсутствие изменения или новый
домен. Смена конкретного URL того же домена выделяется жёлтым. Старейший
загруженный snapshot без предыдущего сравнения не получает
придуманную дельту. При одном snapshot checkbox disabled. Выбор хранится
локально отдельно для пользователя.

## 26. Сезонность частотности

`FREQUENCY_COLLECTION` имеет режимы `FREQUENCY` и `SEASONALITY`. Legacy input
без режима остаётся обычной частотностью. Arsenkin-сезонность использует
официальный `wordstat` `type=3`: `MONTH` требует полные месяцы, `WEEK` —
понедельник-воскресенье и минимум три недели, `DAY` — до 60 дней. Регион,
устройство, `group`, `startdate` и `enddate` передаются явно. До 10 000 фраз
объединяются в одну provider task, но учёт расхода остаётся по ключам: одна
фраза в одном регионе равна одному лимиту. Этот маршрут сохраняет тип `BASE`.

XMLStock-сезонность вызывает документированный GET `pagetype=history` с
`period=month|week|day`, `start/end`, `regions` и `device`. Документация
разрешает Wordstat-операторы в `query`, но live-проверка трёх фраз за два года
вернула для кавычек ту же серию, что и без операторов, а запрос с `!` отклонила.
Поэтому новые XMLStock и Arsenkin seasonality-команды принимают только `BASE`.
Ответ `results[{date,count,share}]` валидируется, сортируется по началу периода
и сохраняется с этим типом. В live-ответе XMLStock допустима строка только с
`date`: она обозначает отсутствие наблюдений за период и нормализуется в
`count=0`; наличие `share` без `count` по-прежнему отклоняется. При чтении
Core SEO обязан отдавать малую `share` обычной десятичной строкой без
экспоненты, независимо от представления Prisma Decimal. Сохранённые до сужения
XMLStock jobs с несколькими
типами остаются читаемыми; claim, уже превысивший исторический лимит попыток,
завершается локально без нового provider HTTP.

Estimate/reservation/settlement не умножают стоимость на число возвращённых
периодов; для XMLStock один keyword создаёт один базовый history-запрос.
Arsenkin получает `correct_dates=true`, а Core SEO для обоих маршрутов
сохраняет только периоды исходного подтверждённого диапазона, поэтому текущий
неполный месяц или неделя не расширяют выбор пользователя.

## 27. Удаление ошибочного среза

Удаление dimension создаёт append-only exclusion до PostgreSQL clock time.
Immutable provider, current projection и billing evidence физически не
удаляются. Все пользовательские чтения,
включая catalog, comparison, dashboard, history и exports, исключают старые
snapshots; будущий съём того же dimension виден. Команда требует
`ranking.configure`, CSRF, `Idempotency-Key` и audit.


## 28. Объединение исторических срезов

`rank_dimension_merges` хранит обратимое правило source → target в границе
workspace/project. Разрешается объединять только срезы с одинаковыми
поисковиком, страной, языком и устройством; регион может различаться. Target не
может одновременно быть source, цепочки и циклы запрещены, несколько source
могут указывать на один target.

Правило не изменяет immutable `rank_snapshots`, manifests или provider
evidence. Catalog скрывает source, а comparison, dashboard, rank-workbench,
rank-history, keyword insights и position export расширяют target всеми его
source. Повторный snapshot одного keyword в один UTC-день схлопывается до
самого нового. Удаление правила возвращает отдельный source без копирования
данных. Создание защищено `ranking.configure`, CSRF, `Idempotency-Key` и audit;
SEO project-transfer routine переносит правило между workspace вместе с
проектом.

### Отображение сохранённой ИИ-выдачи конкурентов

Сохранённый конкурентный снимок виден в карточке запроса независимо от
`position_tracking_enabled` и количества источников. Отсутствие AI-блока
и ответ без ссылок отображаются как завершённый съём, с датой и срезом.
История выдачи запрашивает `includeCompetitors=true`; стандартная история
позиций сохраняет фильтр позиционных снимков. Cursor подписывается вместе с
режимом чтения и не переносится между этими двумя выборками. Открытие полного
ИИ-ответа включает конкурентные снимки, не меняя метрики позиций проекта.
