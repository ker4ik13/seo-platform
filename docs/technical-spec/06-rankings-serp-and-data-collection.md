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

Editable launch profile сохраняет тип выдачи и охват следующего запуска:
весь проект, точный список либо набор папок. Папки отображаются вложенным
раскрываемым деревом; выбор родителя включает потомков, а сервер при сохранении
проверяет каждую папку внутри текущего tenant scope. Перед повторным запуском
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

По ADR-2026-033 provider/credential принадлежат project connector binding, а
schedule/timezone — automation. Экран может показывать их effective projection
рядом с context, но они не входят в immutable tracking configuration.
Provider-specific region ID и форма provider request получаются adapter
mapping при создании immutable execution manifest и не записываются обратно
в tracking context.

Turbo для XMLStock Яндекс Live является launch-only execution option, а не
частью tracking context. Он фиксируется immutable mapping
`xmlstock-yandex-live@3`; обычный Live остаётся на mapping
`xmlstock-yandex-live@2`. Такой выбор не меняет сохранённый контекст и не может
неявно распространиться на последующие ручные или автоматические запуски.

## 2. Конфигурация отслеживания

Экран позволяет:

- создать контекст;
- выбрать запросы по view/group/tag/filter;
- включить/исключить SERP features;
- настроить domain matching;
- выбрать хранение raw SERP;
- сделать test run.

Расписание, provider/fallback и budget настраиваются связанными automation и
connector policy, а не дублируются в context.

Изменение контекста не переписывает историю. Любое изменение поисковой
конфигурации создаёт новую immutable configuration version; rename,
archive/restore меняют только revision логической сущности.
Удаление контекста в пользовательском интерфейсе является soft-delete через
archive: контекст исключается из новых запусков, но immutable manifests,
результаты и история позиций сохраняют ссылку на него. Восстановление снова
разрешает выбирать контекст для запуска.

## 3. Запуск съёма позиций

Wizard:

1. проект и scope;
2. tracking contexts;
3. provider selection;
4. параметры;
5. предварительная оценка;
6. подтверждение.

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

### 3.1. Manual BYOK slice Arsenkin

По ADR-2026-034 и ADR-2026-043 execution slice использует Arsenkin `positions`
после provider contract, entitlement, credential freshness и compatibility
gates.
Context, assignment, binding, estimate и compatibility UI не делают сетевой
запрос; live submit выполняет только isolated connector-worker под новой
kill-switch generation.

Исполняемый scope поддерживает Google Live Desktop/Mobile с глубиной TOP-30,
TOP-50 или TOP-100 и Яндекс Search API/Live с канонической внутренней
глубиной TOP-30, simple format, одним context на provider task и до 15 000
keywords в одном provider command. Публичный contract `positions` не
принимает `depth` для Яндекса: поле не отправляется провайдеру, а значения
TOP-50/TOP-100 блокируются на estimate вместо молчаливого отбрасывания.
Adapter отображает профили в зафиксированные Arsenkin `positions` search
types: Яндекс Search API — `1`, Яндекс Live Desktop/Mobile — `2/3`, Google
Live Desktop/Mobile — `11/12`; регион передаётся только как проверенный
числовой provider ID. Выбранный `SEARCH_API`/`LIVE` является частью immutable
estimate и не может быть заменён при запуске. Raw SERP и platform-paid route
в этот slice не входят; fallback выполняется только через явно настроенный
connector route.
Каждый sealed provider task является одним provider batch: connector вызывает
Arsenkin `set` ровно один раз с массивом `queries` до 15 000 элементов, затем
poll-ит один task ID и нормализует весь task. Делить task на последовательные
paid submit по одному keyword запрещено.
Country, language, safe search и domain rule запрещено молча отбрасывать:
непредставимый context получает compatibility blocker ещё в estimate.

`POST /rank-estimates` не вызывает provider и возвращает versioned scope hash,
configuration versions, credential freshness, provider limits, BYOK allowance
`UNLIMITED`, expiry и `executionAllowed`. `POST /rank-runs` требует актуальный estimate,
`ranking.run`, CSRF и idempotency key; будущий provider submit этого run
дополнительно требует authoritative execution grant.

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
отправляет documented Arsenkin `positions`, durable хранит exact wire
snapshot/hash и task ID, опрашивает `check` и вызывает `get` только после
`TASK_STATUS/finish` с progress 100. Финальный `format=0` ответ
нормализуется из `result.table`: exact query set связывается с sealed manifest,
`position=[1001]` означает not-found, а найденная позиция обязана находиться
в диапазоне 1..sealed depth и иметь URL в разрешённом scope проекта.
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
положительное решение под повторной проверкой graph атомарно создаёт
secret-free scoped execution и становится `CONSUMED`. Dispatcher вызывает
service по одному sealed chunk. Использованные kill-switch versions immutable
и не переиспользуются; runtime activation выдаётся только новой generation
`arsenkin-positions@4`. Connector permission allowlist содержит только exact
claim/authorize/runtime broker execute и не выдаёт table DML.

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
`credentialId + product`: Yandex Live, Google Live, Yandex Search API и
Wordstat имеют независимые bounded concurrency/RPS buckets. Поэтому разные
BYOK-ключи не блокируют друг друга, а один ключ корректно делит provider
capacity между всеми своими проектами и connector replicas. Permit занимает
только реальный внешний HTTP-вызов; `POLL_WAIT`, локальный submit Live и
внутренние DB/SEO Data операции его не удерживают. Коды provider throttling
понижают окно и включают cooldown, а серия успешных ответов постепенно
восстанавливает базовую ёмкость. Redis остаётся только transient capacity
coordination и работает fail-closed; Job/lease/progress source of truth —
PostgreSQL.

XMLStock Яндекс Live Turbo не использует standard Yandex Live bucket: запрос
явно получает `tbm=turbo`, а внешняя пропускная способность остаётся
ограниченной worker concurrency и DB leases платформы. Turbo не занимает
консервативное окно пяти активных provider tasks и исключается из подсчёта
этого окна для стандартных запусков. Обычный Live явно передаёт пустой `tbm`,
поэтому настройка Turbo в кабинете XMLStock не включает повышенный тариф
скрытно. Provider pending code `202` в Turbo повторяется через 15 секунд;
остальные adaptive cooldown правила стандартного Live не меняются.

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

Семантическая таблица показывает для Яндекса и Google текущую позицию,
релевантный URL и дату последнего съёма. `observedAt` заполняется и для
нормализованного `not-found`: в этом случае позиция и URL отображаются красным
крестом, рядом сохраняется последняя найденная позиция, а дата остаётся
доступной. Найденная позиция сопровождается дельтой относительно предыдущего
найденного значения того же keyword ID и поисковика через все версии и
технические контексты, а не дублирует его текстом. Новый регион, устройство
или профиль съёма не сбрасывает известную дельту. Bounded lookup этой истории
опирается на `rank_snapshots_keyword_global_history_idx`. Keyword insights
проецирует для каждой исторической точки только безопасные параметры воспроизводимости:
search engine/source, provider, region label/code, country, language, device,
depth, context name и `observedAt`; provider request ID и raw response в
browser не выдаются. Последний XMLStock или Arsenkin snapshot каждого
поисковика с сохранённым SERP дополнен tenant-scoped Top-10 organic projection
с позицией, URL и доступными title/snippet/favicon URL; в обычной карточке
видны первые пять строк, домен проекта выделяется заливкой без текстового
бейджа, favicon находится под номером позиции, а URL занимает не более двух
строк. Frontend сначала запрашивает корневой `/favicon.ico` домена результата,
использует сохранённый provider favicon как запасной источник и только затем
показывает локальную заглушку. Назначенный target URL сравнивается с текущим ranking URL
по нормализованным host/path и при расхождении остаётся неизменным, а UI
показывает отдельное предупреждение. Semantic list дополнительно получает
только результаты своего project domain из последнего snapshot с позицией и
доступными title/snippet: несовпадение target
URL отмечается оранжевым индикатором, а несколько страниц проекта — кнопкой,
которая открывает в modal только страницы проекта как SERP-карточки с
позицией, favicon, title, description и URL; конкурентский Top-10 остаётся
отдельным блоком карточки запроса и в этот modal не подмешивается.
Визуальный текст всех SERP-ссылок не содержит транспортный префикс
`http://`/`https://`; полный безопасный URL сохраняется в `href` и tooltip.
Незашифрованный исходный `http://` отмечается рядом с URL небольшим оранжевым
открытым замком, для `https://` индикатор не выводится.
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
Колонки дат участвуют в server-side sort, поэтому их
порядок сохраняется при cursor pagination и infinite scroll.

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
owner и точный batch item ID; общий Arsenkin capacity lock берётся до submit.

Core SEO хранит каждый результат append-only в `ai_answer_snapshots` и
`ai_answer_sources` с job ID, engine, region, device, host и `observedAt`.
Уникальность `(job, keyword, engine)` делает повторную доставку идемпотентной,
version fence не позволяет записать результат уже изменённого keyword.
Semantic list проецирует только последний snapshot отдельно для Яндекса и
Google: ИИ-позицию, наличие ответа и дату. Для каждого последнего снимка Core
SEO находит предыдущую найденную позицию того же canonical keyword/engine по
всей append-only истории независимо от региона и устройства: смена контекста
не превращает старый запрос в «новый». Таблица показывает «Новая», рост,
падение, отсутствие изменений или «Была N», если сайт пропал из источников.
При наличии сохранённого ответа у запроса может появиться компактный
индикатор-лупа. Его видимость, как и видимость индикаторов нескольких URL и
несовпадения найденного URL с целевым, задаётся массивом `queryIndicators`
текущего сохранённого представления. Все три индикатора по умолчанию включены
и настраиваются вложенными пунктами под закреплённой колонкой `Запрос`; modal
ИИ-ответа остаётся только экраном просмотра. Modal по лупе загружает
tenant-scoped полный снимок с форматированным ответом, источниками, позицией
сайта, регионом, устройством и временем. Цифровые ссылки Arsenkin вида
`\[1\]\[6\]` в тексте
рендерятся как кликабельные favicon/domain chips соответствующих сохранённых
источников, ведущие на полный URL страницы; неизвестные номера остаются
обычным текстом. Отсутствие AI-блока является валидным результатом, а не
ошибкой provider-а. ИИ-позиции и даты последнего ИИ-съёма поддерживают
server-side сортировку до cursor pagination, отдельно для Яндекса и Google.
Keyword insights отдают до 240 последних ИИ-снимков; sidebar строит график из
14 последних снимков canonical keyword по обоим engine внутри отдельного блока
ИИ-позиций; обычный rank-график остаётся в обычном блоке и не склеивается с
ИИ-историей. Кнопка `История`
загружает полный tenant-scoped журнал keyset-страницами по 200 строк через
аутентифицированный opaque cursor. Последний снимок каждого engine, в котором
были источники, формирует отдельный `Топ конкурентов ИИ`: позиция источника,
title, description и URL; домен проекта выделяется тем же безопасным
presentation-компонентом, что и обычный SERP.
Старое поле `keywords.show_ai_answer_button` временно сохраняется только для
совместимости rolling deployment и больше не является источником видимости UI.
Положительный provider-признак `answerPresent` также является валидным, когда
Arsenkin не вернул опциональные Markdown/source details: persistence не должна
отвергать уже оплаченный ответ только из-за отсутствия этих необязательных
полей. Проектный operation result постранично соединяет Jobs-owned immutable
scope/status с tenant-scoped keyword label и точным SEO snapshot этого Job;
лог доступен во время выполнения и после terminal state, не раскрывает raw
provider payload и не выполняет повторный submit.

Private/noindex Web route
`/app/projects/:projectId/rankings` показывает UTC date range,
context/keyword filters, load-more, loading/empty/error/offline states и
явные archived/read-only пояснения. Сбор запускается только для
provider-compatible Google depth 30/50/100 или Яндекс с внутренней depth 30, numeric-region
конфигурации и свежего пользовательского Arsenkin BYOK credential;
неподдержанные safe-search,
canonical/mirror rules и нечисловой регион блокируются до provider call.

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
optional, если provider их не передал. Это отдельные дочерние immutable строки,
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
синхронны и при глубине TOP-30/50/100 выполняют 3/5/10 страниц по 10
результатов. Turbo Яндекс Live определяет фактический размер первой полной
страницы из поддерживаемых XMLStock значений 10/20/30/40/50 и сохраняет его в
checkpoint `xmlstock-rank-page@2`; TOP-100 поэтому занимает от 2 до 10 GET в
зависимости от настройки аккаунта. Все найденные позиции переводятся в
абсолютный индекс; matching URL сохраняется как ranking/relevant URL, raw XML
отбрасывается после строгой нормализации.

Источник выдачи является обязательной частью immutable estimate и request
snapshot. В первом контуре поддерживаются XMLStock Яндекс Search API, Яндекс
Live и Google Live, а также Arsenkin Яндекс Search API, Яндекс Live и Google
Live. Для Arsenkin Яндекс доступен TOP-30; для Google — TOP-30/50/100. Estimate
показывает расход в единицах провайдера: Arsenkin Google требует соответственно
2/3/5 лимитов на ключ, Яндекс — 2 лимита; XMLStock Search API выполняет один
request на ключ, standard Live — `ceil(depth / 10)` requests на ключ. Для
Яндекс Live Turbo нижняя граница estimate равна `ceil(depth / 50)`, а
фактический расход может достигать `ceil(depth / 10)` и зависит от выбранного
в кабинете XMLStock размера выдачи. Запуск передаёт ровно выбранный
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

Источники: Keys.so и последующие connectors.

Функции:

- organic keywords;
- paid keywords, если доступно;
- top pages;
- shared/unique keywords;
- domain comparison;
- historical data;
- filters by position/frequency/traffic;
- import proposal;
- mapping provider fields;
- estimate and quota.

Результат сначала показывается в staging preview; пользователь выбирает, что импортировать.

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

## 20. Частичные результаты

- Успешные элементы сохраняются.
- Ошибочные элементы имеют retryable/final classification.
- Повтор можно выполнить только для ошибок.
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
обычной выгрузки таблицы. Он принимает выбранные Яндекс/Google и ограниченный
UTC-диапазон, читает append-only BYOK history keyword ID через все tracking
contexts и размещает фактические даты по убыванию в отдельных листах. Значения
позиций записываются числами, отсутствующая позиция — прочерком; строки TOP-5,
TOP-10 и TOP-30 используют Excel-формулы. Первое появление и улучшение
окрашиваются зелёным, ухудшение и переход из найденной позиции в `not-found` —
красным, неизменное значение — нейтральным. Нейтральный прочерк означает, что
позиции нет и в предыдущем фактическом замере; отсутствие snapshot в отдельную
календарную дату не приравнивается к `not-found`.

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
