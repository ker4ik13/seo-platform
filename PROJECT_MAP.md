# Карта проекта

Актуально на 6 сентября 2026 года.

Карта описывает текущее устройство репозитория. Нормативные требования
находятся в `docs/technical-spec/00-index.md`, архитектурные решения — в
`docs/adr`.

## 1. Deployable topology

В проекте ровно три прикладных deployable-сервиса:

| Сервис | Каталог | Назначение | Порты |
|---|---|---|---:|
| Frontend | `frontend` | единый Next.js: публичный сайт, `/app`, `/admin`, BFF | 3000 |
| Backend Core | `backend-core` | Platform API, SEO domain, Realtime, operational alerts, опциональный Web Push | 4000, 4001, 4003, 4004 |
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
               │     │        │                  │
               │     └── WS ──┤                  │
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
перезаписывает файл и не выводит секреты; внешние доменные, SMTP, S3,
Telegram и platform-provider значения остаются явными placeholders. Для NATS
hash он заранее удваивает `$`, чтобы
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
| `backend-core/modules/api` | identity, workspace/project/RBAC, hashed personal API tokens, billing, audit, public API orchestration |
| `backend-core/modules/seo` | semantics, clustering proposals/apply, project Markdown notes, pages, rank manifests/results/history, crawl snapshots |
| `backend-core/modules/realtime` | Socket.IO, session revoke, notifications и Web Push persistence |
| `backend-execution` | durable jobs, queues, imports, vault, provider/rank/crawl/frequency/clustering workers |
| `packages/contracts` | общие versioned HTTP/event/error contracts без бизнес-логики |
| `packages/process-supervisor` | запуск child roles, signal forwarding и env allowlists |
| `packages/operational-alerts` | private exact-envelope receiver/client, Telegram delivery, dedupe и redacted fingerprints |
| `infrastructure` | Dokploy Compose, migrations, ACL/preflight, VPS runtime, monitoring/runbooks |
| `docs/technical-spec` | нормативное продуктовое и техническое ТЗ |
| `docs/adr` | принятые архитектурные решения и rollback paths |

Frontend-представление состояния фоновых операций централизовано в
`frontend/lib/operation-status-presentation.ts`: штатное ожидание асинхронного
ответа провайдера и ожидание его свободного слота не отображаются как ошибочный
«повтор».

Главный проектный обзор в `frontend/components/project-dashboard.tsx` читает
tenant-scoped текущую сводку и до 100 последних rank-срезов через
`keywords/position-summary|position-history`. Отдельный
`project-position-history-chart.tsx` фильтрует период, равномерно ограничивает
визуальную проекцию 30 точками и независимо включает накопительные серии
Топ-3/5/10/30/50, а SVG-проекция следует фактической ширине plot-контейнера;
кнопка «Неотслеживаемые» повторно читает серверную проекцию с
`includeUntracked=true`, не пересчитывая TOP-счётчики в браузере; исходные
append-only snapshots остаются источником истины.
`project-position-date-range-picker.tsx` добавляет inclusive custom range без
нативного browser date UI: на широком экране это двухмесячный popover, на
телефоне — одномесячный bottom sheet с теми же границами доступных срезов.
Пять верхних KPI показывают запросы, отслеживание, среднюю позицию, Топ-10 и
Топ-30. Названия фоновых операций централизованы в
`frontend/lib/operation-collection-purpose.ts`: `COMPETITOR_SERP` отображается
отдельно от position tracking во всех проектных списках.

Проектный result workspace сохраняет общий modal shell, но выбирает таблицу по
immutable purpose. Обычный rank показывает позицию домена проекта, выдача
конкурентов — сохранённые `rank_serp_results` Топ-10, обычный ИИ-съём — сводку
ответа, а ИИ-конкуренты — упорядоченные `ai_answer_sources`. Platform API
передаёт purpose через строгую trusted-проекцию и запрашивает подробные sources
у Core SEO только для конкурентного результата; provider payload, credential
и другие секретные поля в браузер не попадают.

Рабочая область семантики использует единый набор правых панелей: карточка
запроса показывает по одному последнему состоянию Яндекса и Google,
append-only историю самого keyword ID независимо от технического контекста и
проектную заметку. График ограничен 14 последними снимками по времени, поэтому
новый контекст не скрывает более ранние замеры. Кнопка `История` открывает
cursor-paginated журнал всех сохранённых BYOK snapshots самого keyword ID по
200 строк с датой, контекстом, provider, позицией, URL и доступными
title/snippet. Каждая строка получает из своего immutable snapshot bounded
набор страниц проекта с позициями и доступными title/snippet; при нескольких
страницах квадратный групповой индикатор открывает поверх журнала modal только
с этими страницами в SERP-представлении. Для последнего XMLStock или
Arsenkin замера каждого поисковика
карточка читает отдельную immutable Top-10 проекцию нормализованных organic
результатов: первые пять строк видны сразу, остальные — по явному раскрытию;
строки домена проекта выделяются без дублирующего бейджа. Компактная строка
ставит favicon под номером позиции и отдаёт основную ширину title/snippet/URL;
URL допускает не более двух строк. Favicon сначала загружается из корневого
`/favicon.ico` сайта результата; сохранённый favicon из нормализованного
ответа провайдера служит запасным источником, после чего показывается локальная
заглушка. Визуальная подпись SERP-ссылки
не содержит `http://`/`https://`, не изменяя полный кликабельный `href`, а
исходный `http://` обозначается небольшим оранжевым открытым замком. URL
последнего обычного и ИИ-съёма Яндекса и Google находятся в четырёх отдельных
видимых по умолчанию колонках и включаются в обычный экспорт. ИИ URL берётся из
latest `aiAnswers[].rankingUrl`, то есть только из найденной страницы домена
проекта, а не из списка конкурентов. Целевой URL сравнивается с каждым обычным
и ИИ ranking URL после безопасной нормализации host/path; URL-ячейки показывают
только кликабельный адрес без дополнительного текстового статуса, а результат
сравнения остаётся в индикаторе запроса и карточке и не меняет сами данные
замера. Если в последнем сохранённом SERP присутствуют несколько URL
проекта, таблица показывает отдельный индикатор и modal только с этими
страницами: позиция, favicon, title, description и URL без визуального
транспортного префикса; конкурентская выдача в этот modal не подмешивается.
История отображает
текущую позицию и дельту, выделяет `not-found` отдельной осью и интерактивно
проецирует безопасные параметры замера (search source, provider, регион,
устройство, depth и время), не раскрывая provider request ID или raw result;
пять последних сгруппированных дат находятся под графиком, а полный журнал
открывается отдельной кнопкой. Блок последних частотностей расположен после
SERP-конкурентов и непосредственно перед проектной заметкой. Каждая строка
имеет компактное удаление с обязательным modal-подтверждением; команда
tenant-scoped и идемпотентно удаляет все snapshots того же keyword,
type, region и device, чтобы более старое значение не появлялось снова.
Одиночное редактирование из карточки запроса и контекстное действие над тегами
открывают ту же version-aware форму, что и массовое редактирование. Для одной
строки форма позволяет менять текст, язык и остальные поля; для нескольких
строк она отправляет только явно выбранные изменения. Диалог переноса запросов
показывает searchable дерево папок с раскрытием вложенных уровней и полным
путём выбранной папки, не превращая иерархию в плоский select.
Таблица и карточка вычисляют изменение позиции относительно последнего
найденного `rank_snapshot` того же keyword ID и поисковика по всем техническим
контекстам. Для bounded lookup используется
`rank_snapshots_keyword_global_history_idx`; новый регион, устройство или
профиль съёма поэтому не превращает существующий запрос в «Новая».
Удаление сохранённого контекста съёма реализовано как обратимый soft-delete:
контекст исчезает из новых запусков, но не удаляет immutable execution
manifests, результаты или историю позиций.
Стрелки перемещают фокус по загруженным строкам, Shift расширяет диапазон
визуального выделения, а Ctrl/Cmd+клик добавляет или убирает несмежные строки.
Ctrl/Cmd+A визуально выделяет весь текущий серверный filter scope, не меняя
checkbox-выбор для массовых операций; контекстное меню раздельно копирует
выбранные checkbox-строки и визуально выделенные строки в порядке таблицы.
Дерево групп поддерживает явный union от двух обычных групп без
продуктового верхнего лимита; текущая открытая группа уже входит в выбор,
поэтому Ctrl/Cmd+клик по
следующей сразу даёт две группы. Неограниченный union остаётся локальным
источником фильтра таблицы, а эфемерный WebSocket presence публикует его
каноническую bounded-проекцию до 50 UUID; повторная публикация одинаковой
проекции идемпотентна и не запускает render-loop. Контекстное меню после
экспорта показывает все шестнадцать цветов компактной палитрой на всю ширину в
две строки по восемь и через versioned PATCH
меняет цвет сразу у всей выборки; изменение только цвета не переотправляет
позицию. Тот же каталог
`frontend/lib/semantic-group-colors.ts` используется в диалогах создания и
изменения: увеличенные образцы расширенной палитры также идут в две строки под
стилизованным ручным цветом. Создание, изменение, перенос групп и ручной
редактор запросов используют один portaled searchable picker дерева папок,
поэтому раскрытие выбора не меняет геометрию modal. В редакторе запросов
системные группы исключены, а корневой вариант «Без группы» показывается один
раз. Диалог создания принимает обычный многострочный список до 200 названий —
по одной папке на каждую непустую строку; команда
`POST /keyword-groups/bulk` под одной блокировкой дерева и транзакцией создаёт
все папки подряд на одном выбранном уровне либо откатывает весь список.
«Создать рядом» передаёт точную позицию сразу после исходной папки; Core SEO под
блокировкой дерева нормализует позиции siblings.
В основном дереве расширенные кромки строки меняют ручной порядок, а центр
явно вкладывает папку. Обычный промежуток имеет одну цель; при завершении
раскрытого поддерева вложенный и внешний уровни доступны раздельно и до drop
обозначаются разным отступом линии и плавающей над drag-preview подписью.
Двойной клик заменяет только
название обычной папки inline-полем той же геометрии; Enter/blur сохраняют, а
Escape отменяет изменение.
Кнопка рядом с заголовком дерева открывает
`frontend/components/semantic-group-color-legend.tsx`: общий проектный справочник
пояснений ко всем 16 цветам. Core SEO-модуль
`src/semantic-group-color-legends` хранит CAS-версию в
`semantic_group_color_legends`, а персональные monotonic read receipts — в
`semantic_group_color_legend_reads`. `semantic.view` разрешает чтение и отметку
просмотра; отдельное `semantic.manage_group_color_legend` доступно SEO Lead и
выше при effective `MANAGER`. Обновление автора сразу прочитано, остальные
участники видят unread-бейдж до `POST .../seen`; WebSocket переносит только
data-free invalidation, после которого Web перечитывает HTTP API. Additive
migration `20260902120000_semantic_group_color_legends` добавляет обе таблицы и
allowlist переноса проекта.
На экранах до `920px` скрытое desktop-дерево заменяет доступная из шапки
выдвижная панель групп; на телефонах контекстное меню и portaled picker папки
открываются поверх рабочей области как нижние листы, а footer modal остаётся
видимым при прокрутке содержимого.
Дублирование по умолчанию сохраняет дерево подгрупп, но не копирует memberships
запросов. При удалении одной папки опциональное сохранение непосредственных
подгрупп атомарно поднимает их на уровень родителя или в корень, пересчитывает
пути всего сохранённого поддерева и откатывается целиком при конфликте пути.
Обычные
группы создаются и переупорядочиваются отдельно от фиксированных позиций системных
групп, поэтому `Без группы` и `Корзина` не участвуют в вычислении позиции
обычных siblings; position обычной группы является неотрицательным safe
integer без продуктовой границы `1999`. Правый клик по папке никогда не
открывает её и не меняет текущую открытую папку: он только показывает
контекстное меню. Вне текущей мультивыборки меню получает scope папки под
курсором, а правый клик внутри сохраняет batch scope.
Серверный cursor и filter hash привязаны ко всему набору; union принудительно
добавляет регулируемую колонку группы, а обычная плотность показывает под
запросом компактные теги без служебной текстовой подписи языка/отслеживания.
Неотслеживаемый запрос в обеих плотностях получает компактную иконку
перечёркнутого глаза непосредственно перед текстом. Компактная плотность
оставляет одну строку и скрывает inline-теги. Настройки
колонок/представлений и журнал операций не
перезагружают layout. Прогресс rank/frequency остаётся серверным источником
истины, а браузер по изменению safe progress-проекции перечитывает уже
загруженные строки таблицы без full-page reload. Нормализованные rank-results
выбираются для persistence справедливо сначала между workspace, затем между
Job; короткий PostgreSQL claim учитывает уже активные lease, а отдельный
bounded dispatcher запускает свободные persistence lanes раз в секунду,
поэтому большой старый съём не блокирует прогресс нового. Поиск применяет 300 ms
debounce и имеет одну явную очистку с безопасными внутренними отступами.
Его placeholder показывает фактический scope: название обычной или системной
папки, весь проект либо число одновременно открытых групп. Фоновые и realtime-
перезагрузки сохраняют checkbox-выбор и визуальное выделение запросов по
стабильным ID; очистка привязана к фактической смене filter scope, а не к самому
HTTP-запросу или изменению счётчика.
У canonical keyword есть отдельный versioned переключатель `isTracked` с
default `true`. Его меняют форма добавления, sidebar и массовый редактор;
membership tracking context не переписывает это состояние. Новый rank scope и
XLSX-экспорт истории позиций по умолчанию исключают выключенные запросы, а
явный `includeUntracked` в immutable launch/export snapshot позволяет разовый
запуск или экспорт. Retry sealed rank manifest сохраняет исходный scope.
Фильтр тегов предлагает project-scoped активные значения, допускает
произвольную строку и регистронезависимо ищет по нормализованному имени;
серверная сортировка тегов выполняется до cursor pagination, оставляя строки
без тегов внизу. Сброс условий сохраняет текущую папку или union папок.
Сортировка по позиции также выполняется до cursor pagination и всегда делит
выборку на три устойчивых уровня: сначала текущие найденные позиции, затем
`not-found` с известной предыдущей позицией, после них запросы без единого
найденного замера. Направление сортировки меняет порядок чисел только внутри
первых двух уровней и не перемешивает их между собой.
Сортировка по ИИ-позициям Яндекса и Google использует тот же порядок: текущие
найденные ИИ-позиции, затем потерянные позиции с последним найденным значением,
затем запросы с ИИ-ответом, но без найденной ИИ-позиции. Ключи без самого
ИИ-ответа в последнем позиционном снимке либо без замеров находятся в самом
низу, даже если ранее позиция была известна. Это правило применяется сервером
до cursor pagination как для ASC, так и для DESC.

Представления таблицы семантики хранят versioned конфигурацию на сервере:
фильтры, сортировку, порядок/видимость и ширину колонок, плотность, размер
порции infinite scroll, ширину дерева папок, раскрытые папки и выбранный union.
Полный `columnOrder` хранится отдельно от набора видимых `columns`: выключенная
колонка остаётся на прежнем месте в панели, повторно включается без прыжка вниз
и одинаково восстанавливается из private и project-shared представлений.
Текущая `schemaVersion: 3` включает отдельные URL последнего обычного и
ИИ-съёма Яндекса и Google. API временно принимает legacy v1/v2; Web добавляет
обычные и ИИ URL для v1, только ИИ URL для v2 и переводит конфигурацию в v3,
тогда как явная видимость уже сохранённого v3 больше не переопределяется.
Любой участник проекта создаёт и автоматически сохраняет собственное private
представление; optimistic `If-Match` не позволяет тихо перезаписать изменения
из другой вкладки. Общие project-shared представления видны всем участникам,
но создавать, обновлять и удалять их могут только `OWNER`/`ADMIN`; применение
общего вида не включает private autosave и потому не изменяет его для коллег.

Скрытый private layout дополнительно хранит `appliedViewId` конкретного
пользователя. Видимый view применяется отдельной кнопкой-галочкой и остаётся
выбранным после нового входа; при отсутствии явного выбора используется
project-shared «Общее для проекта» (либо первый общий view). Расхождение
текущего layout с применённой конфигурацией помечается как «Изменения не
сохранены». Portaled dropdown внутри drawer входит в его outside-click boundary
и не закрывает панель при выборе scope.

Мастер съёма позиций умеет выбирать сохранённый профиль, раскрывать вложенное
дерево папок и materialize родительский scope вместе с потомками. В
`tracking_contexts.launch_profile` сохраняются только provider-neutral тип
выдачи, режим/UUID папок и явный `includeUntracked`; SEO Data повторно
подтверждает tenant ownership
каждой папки. Выбор сохранённого профиля восстанавливает его полный assignment
как актуальные `keywordId/text/version`, а «Новый контекст» сохраняет переданное
из таблицы выделение. Credential не сохраняется в профиле: UI хранит только
project-scoped локальное предпочтение точного credential ID, повторно проверяет
его среди актуальных подключений workspace, помечает ровно одно подключение и
предупреждает, если после прошлого запуска в выбранных папках появились новые
canonical keywords. Credential ID не попадает в публичный context/job summary.
Проектный экран `/app/projects/{projectId}/rankings/contexts` называется
«Съём позиций» и рядом с профилями показывает связанные rank automations.
Регулярные режимы `DAILY/WEEKLY` используют timezone-aware BullMQ Job
Scheduler, а `ONCE` создаёт один stable delayed job на точный UTC `runAt`.
Одноразовое расписание атомарно получает `ONE_TIME_COMPLETED` при claim первого
run и больше не enqueue-ится reconciliation; повторный запуск требует явно
задать будущий `runAt`. Пауза, optimistic `If-Match`, no-overlap и
failure-threshold остаются общей Automation-моделью, новая таблица не добавлена.
Для явно выбранной связки XMLStock + Яндекс Live мастер дополнительно предлагает
платный Turbo только на текущий запуск. Режим не записывается в provider-neutral
профиль: estimate фиксирует отдельный immutable mapping
`xmlstock-yandex-live@3`, а отсутствие опции сохраняет стандартный Live.

Каталог подписок v4 публикует лимиты `5/2/5k/1`, `20/10/20k/5`,
`50/30/50k/15` и `100/100/unlimited/30` для
users/projects/keywords-per-project/concurrent-jobs. Папки не тарифицируются:
совместимое значение `foldersPerProject = 0` трактуется как отсутствие лимита.
Миграция переводит только неотменённые подписки на новую immutable plan
version, не удаляя периоды, балансы, платежи или ledger history.

Ручное добавление перед мутацией проверяет до 2 000 уникальных строк через
chunked `POST /keywords/bulk-preview`: Core SEO возвращает индекс совпадения,
его текущие группы и состояние active/trash без отражения текста запроса.
Независимые checkbox «Не добавлять дубли» и «Добавить найденные дубли в
выбранную группу» хранят начальные per-project предпочтения в Web storage, а
review-таблица позволяет переопределить действие по каждой активной строке и
строке из «Корзины».
Положительное row-level действие имеет приоритет при включённых обеих опциях:
`ADD_TO_GROUP` атомарно удаляет прежние membership канонической keyword identity
и перемещает её в одну выбранную обычную группу вместо создания второй строки в
`keywords`; версия и история запроса обновляются. Выбранный trash-дубль получает
`RESTORE_TRASHED`, а невыбранный явно остаётся в «Корзине». Остальные совпадения
используют `SKIP_EXISTING`; при выключенном fallback невыбранные активные
совпадения получают `REJECT_EXISTING` и остаются в форме. Ответ сохраняет
совместимые outcomes `LINKED_EXISTING`, reject и обычный skip.

Группы семантики поддерживают tenant-scoped CAS-команду
`POST /keyword-groups/:groupId/duplicate`: Core API проверяет право
`semantic.update` и версию источника, а Core SEO под одной блокировкой дерева
создаёт независимую копию выбранной папки, опционально копирует её поддерево и
memberships существующих canonical keyword ID. Новые keyword rows при этом не
создаются. Web-контекстное меню отдельно предлагает создание папки внутри или
рядом с выбранной группой.

Таблица семантического ядра имеет фиксированную служебную область «позиция
строки → checkbox» и точную pixel-width по сумме видимых колонок. Виртуальный
offset участвует в нумерации; resize одной колонки не перераспределяет свободное
место между соседними, а открытие sidebar меняет только доступный viewport.

Project presence реализован в `backend-core/modules/realtime` поверх
WebSocket-only Socket.IO namespace `/collaboration`. Browser получает
одноразовый 30-секундный project ticket через защищённый Platform API,
подключается только к server-authorized `project:{projectId}` и обновляет
ограниченное состояние
`route/status/cursor/selection/view/activity/editing/sequence`. `activity`
содержит только enum-код открытого semantic workflow и не передаёт заголовок
или содержимое модалки.
Semantic `view` содержит только тип представления и bounded набор UUID активных
папок; пустой набор обозначает корневое представление «Все запросы».
Курсор отправляется не чаще одного раза в 80 ms, heartbeat — раз в 15 секунд,
authorization повторно проверяется не реже раза в 15 секунд и полностью
обновляется новым ticket до окончания 60-секундного lease. Сервер дополнительно
ограничивает burst до 30 событий и устойчивую частоту до 20 событий/секунду на
connection. Состояние каждого connection хранится только в versioned Redis
keyspace `seo-platform:realtime:v1:presence:*` с TTL 30 секунд; Redis adapter
доставляет join/update/leave между нодами, а Redis scan используется только для
bounded snapshot до 500 connections одного проекта. Presence не является
источником бизнес-данных и не попадает в audit.

После успешного committed HTTP-изменения запросов, папок, membership или
кластеров browser отправляет через тот же namespace только opaque
`semantics.change { changeId }`. Realtime повторно проверяет project
authorization и presence join, выводит из ticket `projectId/userId` и рассылает
остальным соединениям комнаты data-free `semantics.changed`. Получатель
debounce-ит сигнал и заново читает через tenant-scoped HTTP API строки,
корневой total, дерево папок с `_count` и SEO-кластеры. В WebSocket не попадают
названия, запросы, версии или вычисленные счётчики; пропущенный сигнал не влияет
на сохранённые данные. Завершение асинхронного импорта отправляет тот же hint
только после подтверждённой публикации результата.

Frontend агрегирует несколько вкладок одного пользователя в одну аватарку в
шапке, исключает текущего и `AWAY`-пользователей, сохраняет user-stable React
identity и короткий leave grace при плановом обновлении WebSocket lease.
Новое соединение стартует как `AWAY` и становится активным только после первого
подтверждённого browser activity, поэтому ротация lease не «воскрешает» аватар
неактивного пользователя.
Детальная визуализация локально отключается кнопкой «Показывать курсоры»;
аватарки при этом остаются. Cursor overlay рисуется только на совпадающих
route и semantic view. Для устойчивого положения на разных размерах экрана
курсор использует безопасный screen/sidebar/modal/row/cell
`data-presence-key` и относительную позицию внутри элемента, а вне anchor —
нормализованные viewport coordinates. Невидимый, прокрученный за viewport или
перекрытый локальной панелью row/cell anchor не отображается; прокрутка больше
не очищает последнее логическое положение cursor.
Удалённое выделение задаётся CSS-классами самих строк/ячеек и поэтому
прокручивается и обрезается таблицей без fixed overlay. Если участник открыл
другую папку или union, дерево показывает ровно один presence-маркер: самую
верхнюю видимую выбранную папку, а для свёрнутой ветки — ближайшего видимого
предка. Cursor/selection в несовпадающем представлении скрываются. Открытый
workflow подсвечивает
соответствующую кнопку toolbar; focus/selection запроса выводит аватарку поверх
номера строки. Таблица семантики публикует только UUID
выбранных/подсвеченных строк и при наличии технический column ID:
текст запроса, значение ячейки, hidden columns и DOM text в WebSocket payload не
попадают. Profile enrichment и avatar bytes читаются отдельными
permission-scoped `GET /api/v1/projects/:projectId/presence-members[/…]` из
Platform API; Realtime не обращается к `platform_db`. `socket.io-client@4.8.3`
является единственной новой production-зависимостью frontend и совпадает с
версией server protocol, поэтому Socket.IO framing не реализуется вручную.

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
выдаётся браузеру. WebSocket использует same-origin `/socket.io`; минимальный
custom Next server принимает только exact Socket.IO upgrade path, удаляет
Cookie/Authorization перед proxy и направляет соединение на canonical
`REALTIME_INTERNAL_URL`, не открывая порт 4003 и внутренний hostname браузеру.
Production публикует Platform API на отдельном `API_PUBLIC_URL`. Одноузловой
VPS runtime создаёт эквивалентный TLS-вход на `https://<public-host>:4000`:
Caddy проксирует только `/api/v1[/…]` на loopback Core, а `/internal/v1` и
остальные пути на этом listener получают `404`. Поэтому `/docs/api` всегда
показывает проверяемый внешний origin, не подменяя его Web/BFF-адресом.

Browser BFF-клиент обрабатывает истечение короткого access token централизованно:
параллельные `401` объединяются в одну rotation через `POST /app/auth/refresh`,
после чего каждый исходный same-origin запрос повторяется не более одного раза
с новым CSRF token. Истинно завершённая refresh session остаётся terminal и не
порождает цикл повторов или ложную ссылку на настройку provider route.
Страница `/app/login` до показа формы проверяет серверную auth session и при
действующем access token либо наличии refresh cookie сразу перенаправляет на
`/app`; истёкший access token затем проходит через общий protected refresh flow.

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
значении sidebar, семантики и project-scoped экранов.
Порядок проектов является общей workspace-настройкой Core, а не локальным
предпочтением браузера. Все project selectors используют один `ProjectSelect`
и получают authoritative порядок `display_order`. Пользователь с полным
доступом ко всем проектам и `workspace.update` может перетащить строку либо
использовать `Alt+ArrowUp/ArrowDown`; Web отправляет полный исходный и новый
списки ID на `PUT /api/v1/workspaces/:workspaceId/projects/order`. Core
сериализует перестановку workspace-lock, отклоняет неполный, чужой или
устаревший список с precondition error и тем самым сохраняет одинаковый
порядок для всех участников. Перенесённый или созданный проект добавляется в
конец списка. Footer sidebar показывает «Создать проект» только при
`project.create`, активной workspace и свободной тарифной capacity; причина
недоступности остаётся видимой, но искусственного лимита размера списка нет.
Если пользователь не владеет ни одной workspace, tenant switcher показывает в
footer явное действие создания, ведущее в тот же onboarding; членство в
областях других владельцев не скрывает действие. При полностью пустом списке
switcher остаётся раскрываемым.
Tenant switcher локально запоминает последний открытый project ID отдельно по
`userId + workspaceId`. При смене workspace он переносит этот opaque ID в
обычный server-readable tenant cookie; Core-authoritative список проектов
повторно подтверждает доступ, а отсутствующий, удалённый или перенесённый
проект заменяется первым доступным проектом стандартного порядка.
Общий operation scope picker объединяет выбранные папки в один exact union,
берёт authoritative count однострочным probe, останавливается сразу при
превышении provider limit и materialize-ит допустимый набор страницами по 1000
строк вместо последовательного обхода каждой папки.
Core API одним
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
- Внешний клиент входит теми же `/api/v1` tenant routes через Bearer personal
  API token. Plaintext `seo_pat_*` показывается один раз; Platform DB хранит
  только HMAC hash, display prefix, expiry, scopes и project allowlist.
  Create/rotate открывает обязательную one-time modal: Escape, backdrop,
  close и финальная кнопка заблокированы до подтверждённого clipboard copy
  либо пользовательского `copy` из выделенного секрета.
  При rotate предыдущий hash остаётся допустим ровно 10 минут для bounded
  handover; revoke немедленно блокирует и текущий, и предыдущий material.
  Session-only workspace/account/team/billing/API-token-management routes fail
  closed.
  Отдельный token-only `GET /api/v1/access` не принимает cookie-session и без
  входных tenant ID возвращает workspace, scopes и упорядоченное пересечение
  текущего project access пользователя с allowlist ключа. Это единственное
  parameterless исключение из обычной `TenantPermissionGuard` boundary;
  `ApiTokenOnlyGuard` делает его явным и fail-closed.
  Публичная документация берёт canonical API origin только из runtime
  `API_PUBLIC_URL` (в local development — из `PLATFORM_API_INTERNAL_URL`),
  поэтому curl-примеры не зависят от домена конкретного окружения.
  Tenant guard сначала пересекает route scope и allowlist, затем повторно
  проверяет текущие RBAC/project permissions пользователя-создателя; поэтому
  token не переживает отзыв членства и не расширяет права principal. При
  переносе проекта в другой workspace старые project allowlist grants
  удаляются в той же транзакции до смены tenant ownership.
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
- публичная документация `/docs/api` разбита на отдельные section routes с
  общим searchable sidebar, копируемыми примерами запросов/ответов и
  постраничной навигацией; quick start начинает с identifier-free
  `GET /access`, а единый каталог разделов и public endpoints хранится в
  `frontend/lib/api-docs.ts`.
- `lib/server-runtime-origin.ts` валидирует canonical `WEB_PUBLIC_URL` и
  внутренний Platform API origin; production web origin обязан использовать
  HTTPS и не может быть локальным именем.

### `backend-core`

- `src/main.ts` — supervisor;
- `src/alert.main.ts` — private operational-alert receiver, порт 4004;
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
  `integration-credential-validation`, а также отдельным bounded runtime loop
  для `AI_ANSWER_COLLECTION` и `CLUSTERING_RUN`; clustering использует тот же
  быстрый dispatch queue, но отдельный durable Job/runtime;
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
Оба backend supervisors и Frontend отправляют внутренние ошибки в private
receiver через отдельный `OPERATIONAL_ALERT_TOKEN`; только Core child
`alert.main.ts` получает Telegram bot destination. Exact envelope не содержит
message/stack/request/tenant payload, одинаковые fingerprints дедуплицируются,
а порт 4004 не публикуется. Split-process VPS supervisor хэширует error/fatal
строку локально и передаёт только code/severity/fingerprint.
После успешной операторской SMTP-проверки тот же runtime опционально запускает
отдельный `auth-email-worker` с единственными разрешёнными Jobs DB, NATS,
Platform JIT и SMTP credentials; без `AUTH_EMAIL_ENABLED=true` процесс не
создаётся. Readiness worker является обязательной частью старта включённой
почты, а его graceful shutdown получает окно больше внутреннего drain budget.
Arsenkin DB broker
сохраняет общий bounded task capacity и lease fencing между всеми процессами.
ИИ-съём и clustering используют собственные наборы `SECURITY DEFINER` broker-функций для
claim/renew/submit/defer/fail/complete. Роль connector-а имеет `EXECUTE` только
на эти exact routines и не получает прямой DML к Jobs-таблицам; batch
проверяется по Job type, project/credential route, version, lease и точному
набору items при каждом переходе.
XMLStock HTTP ограничивается распределёнными Redis buckets по
`physicalCredentialScopeId + product` (`YANDEX_LIVE`, `GOOGLE_LIVE`,
`YANDEX_SEARCH_API`, `WORDSTAT`): разные API-ключи не блокируют друг друга,
один ключ делит лимит между своими проектами. Permit удерживает только внешний
HTTP, не `POLL_WAIT`; базовые окна соответствуют provider boundary:
Yandex Live — `20 concurrent / 10 RPS`, Google Live — `48 / 30`, Yandex
Search API — `48 / 50`, Wordstat — `10 / 10`. Throttling адаптивно уменьшает окно. Состояние limiter
хранится только в connector ACL namespace
`seo-platform:jobs:v1:provider-rate-limit:*`. PostgreSQL fair claim
предпочитает менее занятую пару credential/project, оставаясь source of truth
для Job, lease и progress.
Platform-paid XMLStock/Arsenkin поддерживает до 64 operator-owned credentials
в comma-separated plural env. Management-role Jobs HTTP формирует
HMAC-derived opaque UUID каждого физического ключа (через самый старый
fingerprint key); platform credential request fingerprint сохраняется с той
же key version, поэтому key-coverage удерживает её во время overlap rotation.
Весь пул остаётся только
в зашифрованном workspace vault payload. Новый модуль
`backend-execution/src/integrations/platform-credential-pool.ts` выбирает ключ
rendezvous hashing по immutable execution ID: выбор стабилен для submit/poll и
рестартов, не зависит от порядка env и равномерно распределяет параллельные
Jobs. Connector использует opaque UUID как общий между workspace/replicas
Redis scope; raw key и account ID в Redis/Job/log не попадают. Arsenkin rank
получает отдельный rolling window `30 requests / 60 seconds` на физический
ключ, а общий PostgreSQL lifecycle cap пяти task остаётся консервативной
source-of-truth защитой provider task graph.
Яндекс Live Turbo является отдельным явно оплаченным mapping: connector
передаёт `tbm=turbo` и не применяет к нему стандартный Redis bucket XMLStock,
поскольку provider документирует неограниченное число потоков. Turbo также не
занимает общий Arsenkin-only лимит пяти активных provider tasks. Обычный
XMLStock также не занимает этот lifecycle limit: dispatcher за тик готовит до
48 immutable keyword chunks на Job, а фактическую внешнюю параллельность
ограничивает Redis bucket выбранного credential/product. Платформенная worker
concurrency, lease fencing и PostgreSQL claim остаются bounded safety границей; обычный Live явно
передаёт пустой `tbm`, чтобы настройка кабинета не включала Turbo неявно.

## 5. Владение данными

| Данные | Модуль-владелец | Текущее хранилище |
|---|---|---|
| users (включая bounded account avatar до 512 KiB), sessions, hashed personal API tokens и project allowlists, workspaces (включая bounded workspace avatar до 512 KiB), projects, их общий `display_order` и bounded project logos до 512 KiB, project transfer requests, RBAC, billing ledger/usage reservations, audit, platform admin command receipts | Core API | `platform_db` |
| semantics (включая keyword notes, saved views, проектные легенды цветов и персональные read receipts, presets минус-слов и durable clustering proposals), project Markdown notes, pages, rankings, immutable normalized XMLStock/Arsenkin SERP results и Arsenkin AI-answer snapshots/sources, crawl/page-map projections | Core SEO | `seo_db` |
| realtime subscriptions, deliveries, event inbox | Core Realtime | `realtime_db` + Redis |
| jobs, schedules, uploads, credential vault, provider execution | Execution | `jobs_db` + Redis + S3 |

У каждой Prisma schema своя migration history. Migration owner и application
runtime roles разделены. Сложные PostgreSQL primitives (`COPY`, partitioning,
specialized indexes, bounded claim/broker functions) остаются параметризованным
SQL в repository/permission boundaries; обычный CRUD выполняется через Prisma.
Unsafe Prisma raw APIs запрещены статическим тестом.

## 6. Ключевые потоки

### Ручной съём позиций и Top-100

1. Frontend запрашивает estimate через Core; materializer дедуплицирует
   canonical keyword ID и исключает `isTracked = false`, если launch profile не
   содержит явный `includeUntracked`.
2. Execution фиксирует immutable snapshot binding/route/credential versions.
3. Rank role создаёт sealed manifest в Core SEO.
4. Core повторно проверяет lifecycle, RBAC и entitlement и выдаёт короткий
   grant. Внутренней дневной квоты на BYOK rank нет; статус estimate —
   `UNLIMITED`. Для `PLATFORM_PAID` trusted price book сначала создаёт
   double-entry резерв included/prepaid токенов с stable economic reference
   на Job item; новый execution attempt не списывает его повторно.
5. Connector role выполняет fenced provider submit через DB broker. Для
   синхронного XMLStock перед первым HTTP request он читает только `grantId`
   и credential mode через закрытую `SECURITY DEFINER` функцию и получает у
   Core bounded `HOLD`, который не меняет ledger. После подтверждённого
   платного provider outcome connector вызывает `CAPTURE` с отдельным
   `JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN`; только exact `CAPTURED`
   разрешает сохранить provider outcome. Reject/rate-limit/transport
   ambiguity не списывают токены. BYOK не обращается к ledger; просроченные
   неиспользованные резервы release-ятся bounded reconciliation через 10 минут.
6. Rank role публикует normalized chunks и terminal result. Для XMLStock тот
   же hash-bound chunk содержит упорядоченную выдачу до выбранной глубины
   Top-100, для Arsenkin — доступную в ответе `top20` проекцию и найденный URL.
   Raw provider response не сохраняется: Core SEO пакетно создаёт дочерние
   immutable строки rank snapshot, а frontend читает только tenant-scoped
   проекцию.

Тот же pipeline обслуживает отдельный `COMPETITOR_SERP`: Arsenkin вызывает
официальный `check-top` с Топ-10 и snippets, XMLStock ограничивает существующий
SERP connector глубиной 10. Оба всегда сохраняют конкурентные
`rank_serp_results`. Только конкурентная modal показывает
`saveProjectPosition`: при включении найденная в той же выдаче страница проекта
может обновить позицию без второго provider request; при выключении либо
отсутствии сайта immutable snapshot помечается
`position_tracking_enabled=false` и исключается из `current_ranks`, истории,
графиков и позиционного экспорта. Migration
`20260902163000_competitor_position_tracking_policy` добавляет этот gate к rank
и AI snapshots без изменения старых строк. Migration
`20260902194500_competitor_rank_estimate_counts` синхронизирует DB-инвариант
оценок XMLStock: для `COMPETITOR_SERP` стоимость Live-выдачи считается по
фактически собираемому Топ-10, а обычные position estimates продолжают
считаться по глубине tracking context.

System XMLStock/Arsenkin credential создаётся только пользователем с
`integration.use_system_credentials`: Core передаёт provider, а Execution HTTP
шифрует operator-owned deploy secret pool в workspace vault и запускает обычную
read-only validation. Browser не получает platform account/quota/secret и не
задаёт цену. Arsenkin customer charge считается по keyword, хотя provider
получает один batch task. Platform flags по умолчанию выключены; текущий
runtime выполняет reserve до provider call и capture после provider response,
до локального complete. Для каждого provider Core требует deploy-настройки
суточного и месячного hard spend cap: provider-scoped advisory transaction
lock сериализует reservations между workspace, а budget exposure включает
captured usage текущего UTC-окна и все живые reservations. Превышение
останавливает grant до ledger/provider I/O. Индексы миграции
`20260829103000_provider_spend_budget_indexes` ограничивают global budget read.
Production activation всё ещё ждёт fault-injection canary,
refund/reconciliation, legal approval и provider balance alert.
Rank automation может использовать этот же paid path только с сохранённым
явным `maxPlatformChargeMicro` на один запуск. Каждое расписание и ручной
automation run вызывает закрытый Core dispatch через
`JOBS_TO_PLATFORM_AUTOMATION_TOKEN`; Core заново проверяет текущие RBAC,
workspace/project lifecycle, entitlement, quota, job capacity и trusted price
book, создаёт fresh estimate и продолжает стандартным reservation/settlement
RankRun лишь если точная цена не выше cap. Значение `0` сохраняет BYOK-only
поведение старых расписаний. Rank automation definition `@3` больше не содержит
пользовательский `maxItems`: каждый occurrence снимает весь актуальный tracking
context, а сохранённый cap из `@1/@2` валидируется только при чтении и затем
отбрасывается. Показываемый тарифный лимит относится к числу включённых
rank/crawl-расписаний workspace, а не к ключам. `retry-missing` для paid mode
пока не разрешён.

Миграция `20260818150000_rank_serp_results_top100` расширяет только DB-check
immutable `rank_serp_results.position` с Top-10 до Top-100; существующие
строки не переписываются, PK/FK и запрет UPDATE/DELETE сохраняются.
Миграция `20260818173000_rank_serp_result_favicons` добавляет в эти же
immutable строки nullable `favicon_url`: сохраняется только безопасный
абсолютный `http/https` URL, присутствующий в provider SERP, без отдельного
запроса к сайту результата.

XMLStock Google Top-100 собирается десятью последовательными страницами по 10
результатов; XMLStock Yandex Live использует такой же GET-only page mapping,
тогда как Yandex Search API остаётся submit/check. Для Live каждая успешно
оплаченная страница сохраняется в hash-проверяемом secret-free checkpoint в
`jobs_db`; следующий poll запрашивает ровно следующую страницу, а временный
429/5xx повторяет только текущую страницу. Поэтому сбой на второй–десятой
странице не теряет уже собранный Top и не создаёт повторную оплату за него.
Успешный page checkpoint делает следующую Live-страницу доступной немедленно;
distributed RPS limiter всё равно сериализует внешний GET. Provider pending
и retryable failure остаются в отложенной очереди с `next_action_at` и не
удерживают connector worker.
Poll/recovery остаётся lease-fenced и bounded. Для одного XMLStock keyword
execution разрешено не больше 50 фактических provider HTTP poll/get попыток:
capacity deferral откатывает счётчик, READY на 50-й попытке сохраняется, любой
другой исход после неё становится `FAILED_FINAL` без 51-го запроса. Старые
`POLL_WAIT`/просроченные `FETCHING` строки выше границы migration завершает без
provider I/O. Arsenkin batch lifecycle сохраняет отдельную прежнюю границу 720,
потому что один provider task содержит весь batch, а не один keyword.
Arsenkin rank/check-top polling принимает progress как число либо числовую
строку с необязательным `%`, но по-прежнему требует согласованную пару
`process/<100` или `finish/100`; неизвестные состояния завершаются fail-closed.
Terminal XMLStock result scope добавляет каждой строке status, pollAttempts и
allowlisted errorCode; Web отделяет неснятые запросы в блок «Не удалось снять
позиции», не смешивая их с успешными snapshots.
Для Yandex Live Turbo первая страница определяет документированный размер
`10/20/30/40/50`, который сохраняется в checkpoint v2; Top-100 поэтому требует
от двух до десяти GET в зависимости от настройки количества результатов в
кабинете XMLStock. Код `202` сохраняет текущий checkpoint и повторяет только
эту страницу через 15 секунд.
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
Tenant-scoped `GET .../jobs/:jobId/runtime-diagnostics` отдаёт только
безопасный live-снимок XMLStock execution: текст доступного пользователю
ключа, логический цветной поток, sequence, состояние, счётчики HTTP
submit/poll, page progress и allowlisted error code.
Credential, provider request ID, raw payload и физическое имя worker наружу не
выдаются; UI накапливает короткий журнал только пока открыта подмодалка логов.
General `jobs_runtime` по-прежнему не читает private
`rank_provider_request_intents` напрямую: HTTP-сервис получает только
tenant-scoped allowlist полей через owner-owned
`read_rank_runtime_diagnostics_entries`, где active-state вычисляется внутри
БД без выдачи физического lease owner.
Для XMLStock-съёма кнопка входа в этот монитор находится прямо в header
результата, открытого из сайдбара операций, а не занимает место в таблице или
контекстной строке результата.
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

### Проверка ИИ-ответов

Отдельное действие семантики `Проверить ИИ-ответы` создаёт фоновый
`AI_ANSWER_COLLECTION`, не смешивая результат с обычной позицией. Execution
вызывает документированный инструмент Arsenkin `ai-serp` для одного выбранного
поисковика (`YANDEX`/`GOOGLE`), региона, устройства и домена; один keyword
расходует два лимита Arsenkin. Submit/check/get выполняются lease-fenced через
общую Arsenkin provider-task capacity вместе с rank/Wordstat, поэтому новый
тип работы не обходит лимит credential.

Конкурентная команда «Собрать ИИ-выдачу» использует тот же `ai-serp` с
`purpose=COMPETITOR_SERP`, но не показывает поле домена: Web передаёт host
проекта, обязательный по provider API, и пустые brands. Ответ и sources
сохраняются всегда. Отдельная только для конкурентных modal галочка разрешает
использовать найденную страницу проекта как ИИ-позицию из этого же ответа;
выключенный флаг не запускает второй запрос и оставляет positional projection
неизменной через `position_tracking_enabled=false`.

Core SEO version-fenced разрешает keyword ID, идемпотентно сохраняет
append-only `ai_answer_snapshots` и упорядоченные `ai_answer_sources`, а
передача проекта re-key-ит snapshot в той же allowlisted транзакции. Provider
HTML не попадает в browser: connector преобразует разрешённую структуру в
ограниченный Markdown, а frontend рендерит его без raw HTML. Semantic list
получает только последнюю проекцию Яндекса/Google для отдельных колонок
ИИ-позиции и даты. `ai-answer-history-projection.ts` находит предыдущую
найденную позицию canonical keyword/engine по всей append-only истории без
привязки к region/device, поэтому таблица корректно показывает `Новая`, рост,
падение, отсутствие изменений и потерю позиции после смены контекста.
AI-кнопка у запроса появляется для любого сохранённого снимка, включая
`answerPresent=false`, и открывает подробный modal с полным ответом либо честным
состоянием его отсутствия, наличием/позицией домена, источниками, регионом,
устройством и временем конкретного immutable снимка. Цифровые ссылки Arsenkin вида `\[1\]\[6\]`
преобразуются в кликабельные favicon/domain chips сохранённых источников и
ведут на полные URL страниц. Sidebar показывает обе последние ИИ-позиции,
график 14 последних снимков и отдельный последний `Топ конкурентов ИИ` для
каждого engine, у которого когда-либо были сохранены источники. Полный журнал
доступен через tenant-scoped keyword route keyset-страницами по 200 строк;
opaque cursor подписан и привязан к workspace/project/keyword. Live
reconciliation таблицы обновляет keyword projection
при каждом новом состоянии операции, включая случай, когда первым увиденным
состоянием уже является terminal. Drawer семантики и общий проектный журнал
открывают cursor-paginated лог `AI_ANSWER_COLLECTION` как во время выполнения,
так и после завершения: для каждого зафиксированного keyword показываются
execution status/attempt, факт отправки провайдеру, finite error и сохранённая
проекция ответа. Arsenkin может подтвердить наличие ИИ-ответа без опционального
текста или списка источников; такой оплаченный результат является валидным и
не маскируется ошибкой отсутствующего keyword.

Последние URL домена проекта из ИИ-ответов Яндекса и Google дополнительно
показываются в колонках `yandexAiRelevantUrl` и `googleAiRelevantUrl`, участвуют
в проверке целевой страницы и обычном экспорте. Видимость лупы ИИ-ответа,
индикатора нескольких URL и предупреждения о
несовпадении целевого URL задаёт `queryIndicators` активного semantic saved
view. В старых представлениях без поля все три включены; настройки показаны
вложенными пунктами под закреплённой колонкой `Запрос`, сохраняются одинаково
для private и project-shared views, а modal ИИ-ответа остаётся read-only.
Legacy-поле `Keyword.showAiAnswerButton` оставлено совместимым с rolling
deployment, но отображением строки больше не управляет.
Обычные Яндекс/Google позиции выведены в
одной компактной строке только цифрой, `×` или `—`; обычный и ИИ-графики
находятся в соответствующих раздельных блоках sidebar.

### Поиск по списку запросов

`frontend/components/semantic-multi-search-dialog.tsx` открывается отдельной
иконкой слева от обычного поиска и принимает до 500 уникальных строк. Режимы
`EXACT|CONTAINS|ALL_WORDS` выполняются в Core SEO через body-only
`POST /keywords/search`: полный список не попадает в URL или query string
логов, а текущие фильтры, сортировка и keyset cursor сохраняются. Из результата
можно оставить серверный фильтр в таблице, выбрать все совпадения либо открыть
стандартный перенос в папку. Общий
`frontend/components/semantic-group-picker.tsx` переиспользует одно компактное
дерево папок в управлении группами, ручном редакторе запросов, переносе
запросов и review кластеризации.
`frontend/components/unsaved-changes-confirmation.tsx` даёт общий modal guard
для черновых изменений в review кластеризации, неявных дублях и минус-словах;
крестик, Escape, клик по фону и кнопка отмены проходят через один сценарий.

### Кластеризация запросов

Действие семантики `Кластеризовать` разрешает versioned keyword scope вручную,
из дерева папок или всего проекта и создаёт отдельный `CLUSTERING_RUN` в
Execution. Параметры фиксируют Arsenkin credential route, поисковик, регион,
soft/hard, число общих URL, глубину ТОП, главные страницы, стоп-домены,
частотность и явное разрешение перекластеризации. Connector выполняет одну
Arsenkin `clustering` task через `set/check/get`; четыре fenced broker-функции
проверяют tenant/project/credential route, полный immutable набор items,
job/lease version и persisted submit marker. Общий лимит пяти Arsenkin tasks
считает rank, Wordstat, AI answer и clustering вместе.
Connector `arsenkin-clustering@1.1.0` нормализует как табличные варианты
ответа, так и фактическую вложенную проекцию
`result.clustering.clustered|single`, где запросы являются ключами `words`;
per-word `main` не трактуется как метрика всего кластера. До 100 URL-доказательств
кластера вместе с числом пересечений сохраняются в bounded `top_urls` JSONB;
браузеру не передаётся raw provider response.
Один запуск ограничен 300 000 запросов на UI/API/broker/proposal boundaries;
крупный versioned scope принимают только точные clustering routes с body limit
32 MiB, а trusted proposal ingestion — 256 MiB. UUID-массив broker-команд
передаётся одним PostgreSQL-параметром и не упирается в лимит bind parameters.
В мастере слева и по умолчанию стоит жёсткая группировка, все виды частотности
изначально выключены. Первый запуск для Яндекса и Google выбирает Москву
(`213` и `1011969`); после принятого запуска Web восстанавливает последний
регион отдельно для проекта и поисковика.
Catalog и validation broker сохраняют `CLUSTERING` на активном проверенном
Arsenkin credential; миграция backfill обновляет существующие подключения без
ротации ключа, а единый DB-trigger не даёт `WORDSTAT`/`CLUSTERING` исчезнуть
при последующих изменениях credential.

Нормализованный результат сохраняется в Core SEO модулем
`src/clustering-proposals` в трёх таблицах proposal/cluster/item и не меняет
текущую семантику. Только trusted ingestion route proposal получает bounded
body limit 256 MiB для полного результата до 300 000 строк. Public result объединяет Jobs summary с proposal, всеми
   bounded cluster descriptors и cursor-paginated строками. Уже назначенный
   SEO-кластер не является конфликтом: result сообщает число таких строк в
   каждом provider-кластере, а реальный `CONFLICTED` означает изменение версии
   запроса после запуска. Drawer «Операции»,
общий журнал и private/noindex result workspace показывают прогресс и лог.
Cluster descriptors и общая первая cursor-страница загружаются отдельно от
строк конкретной карточки. Развёрнутая видимая карточка лениво читает
`GET /clustering-runs/:jobId/result/sections/:sectionId`; Core SEO использует
индекс `(proposal_id, proposal_cluster_id, sequence)` и возвращает не более 200
строк за раз. Поэтому карточка с известным `keywordCount` не остаётся пустой,
если её запросы не попали в общую первую страницу, и UI не материализует все
300 000 строк одновременно.
   В готовом proposal пользователь переименовывает кластеры и для каждого
   независимо выбирает SEO-кластер (новый, конкретный существующий или оставить
   текущее назначение) и папку (создать, перенести в существующую либо оставить
   membership). Выбранные parent новой папки и target существующей папки
   запоминаются раздельно при переключении режима, а command содержит только
   destination активного режима. Для новой папки parent выбирается прямо
в карточке конкретного кластера, а корень проекта является значением по
умолчанию. Выбранным запросам можно назначить другую существующую папку; такое
точечное решение имеет приоритет над решением кластера. «Некластеризовано»
остаётся на месте по умолчанию либо создаётся отдельной папкой. Apply под advisory locks
повторно проверяет current versions и locked/excluded кластеры, folder
entitlement, создаёт `ARSENKIN_SOFT|ARSENKIN_HARD` clusters, необязательные
membership папок и semantic versions пакетами до 500 изменений. Любое явное
назначение папки является переносом с удалением прежних обычных membership;
режим «Не переносить» сохраняет их. Reject закрывает proposal без доменных изменений. Решение
зафиксировано в `docs/adr/ADR-2026-044-arsenkin-clustering-proposals.md`.

Массовый редактор, перенос запросов в папку и preview/apply очистки не обрезают
selection scope на синхронном пределе: общий frontend orchestrator делит выбор
на versioned команды по `semanticKeywordBulkCommandMaxItems=200` строк,
проецирует каждую строку в exact `{id, version}` до HTTP и агрегирует полный
результат. Поэтому данные UI-строки не попадают в строгий command payload, а
457 и более выбранных строк проходят без ошибки валидации, сохраняя короткие
bounded HTTP-команды. Аналогично массовое
назначение посадочной сохраняет все выбранные кластеры, а Web делит только
транспорт на команды по `semanticClusterPageBulkMaxItems=200`; атомарные
merge/split сохраняют собственные смысловые ограничения.

### Сбор частотности

Публичная command boundary принимает до 10 000 keywords и для Arsenkin, и для
XMLStock. Это platform safety bound, а не лимит XMLStock: Arsenkin отправляет
одну provider batch-задачу, XMLStock сохраняет тот же Job, но connector
выполняет по одному keyword на внешний `/wordstat/json/` request. Внутренние
resolve/persist chunks и per-credential `WORDSTAT` concurrency/RPS остаются
bounded, поэтому снятие прежнего UI/API-предела 200 не создаёт один гигантский
provider request и не связывает между собой разные BYOK-ключи.
Первый запуск wizard выбирает регион «Россия» (`225`), после успешного запуска
восстанавливается последний Wordstat-регион этого проекта; в списке далее идут
Москва и Санкт-Петербург. Настройки проекта хранят nullable согласованную пару
кодов российского города для Яндекса и Google. Позиции выбирают регион в
порядке: последний завершённый съём конкретного поисковика, город проекта,
Москва; источник значения явно подписан в селекте. ИИ-ответы и кластеризация
начинают с Москвы и запоминают последний успешный регион раздельно по проекту,
инструменту и поисковику. Клиентская валидация и storage fallback
сосредоточены в `frontend/lib/semantic-region-preference.ts`; недоступный код
сбрасывается к безопасному начальному значению. `frontend/lib/seo-regions.generated.ts` хранит
проверенный snapshot полного российского subtree Яндекса (638 кодов) и всех
российских Google location ID текущего provider catalog (504 кода), а
`frontend/lib/seo-regions.ts` отдаёт отдельные provider-specific списки без
ложного сопоставления кодов между системами.

### Keys.so и расширение Wordstat

Проектная вкладка `/app/competitors` теперь является рабочим пространством
`Keys.so и Wordstat`. Один Jobs-owned `keyword-research-runtime` обслуживает три
явных source: `KEYS_SO` получает dashboard TOP-метрики, organic keywords и
конкурентов домена, `ARSENKIN_WORDSTAT` запускает документированный Wordstat
tool `type=2` для не более 500 seed-фраз, а `XMLSTOCK_WORDSTAT` выполняет
по одному GET `/wordstat/json/?pagetype=words` на seed. Оба Wordstat source
сохраняют до 10 000 нормализованных строк из основной и правой колонок.
Preview получает первые 500 строк вместе с run summary и дальше догружает
immutable строки keyset-страницами по `ordinal`, поэтому результат Wordstat
скроллится до конца без одного тяжёлого ответа.
Arsenkin не получает пользовательский параметр лимита результата: UI скрывает
его для этого провайдера, а 10 000 остаётся только внутренней границей
нормализованного staging. Для XMLStock пользовательский лимит сохраняется.
Выбранные строки Keys.so можно сразу передать в Wordstat без ручного
копирования; провайдер выбирается явно, а регион нового expansion run всегда
начинается с России (`225`).
Та же `WordstatExpansionDialog` запускается из основной панели инструментов
семантики: открытая папка и отмеченные запросы передаются в её стандартный
scope picker, а ручной ввод остаётся доступен даже в пустом проекте. Созданный
run отображается в сайдбаре операций семантики и в общем журнале; просмотр и
импорт используют уже существующий research result workspace.

`keyword_research_runs/keyword_research_rows` хранят immutable input,
нормализованный staging preview, opaque provider task marker, lease/version и
import state. Connector-worker не пишет Core SEO: после явного confirm
отдельный import-worker передаёт `ALL` либо выбранные строки bounded chunks по
500 в существующую папку или в новую папку под выбранным parent. `ALL`
означает весь server-side результат независимо от числа загруженных
preview-страниц: browser передаёт только bounded `excludedRowIds`, а
`selectedRowIds` допустим только для режима `SELECTED`. При confirm
Wordstat-строки не получают автоматические provider/source-теги; источник и
исходная фраза остаются в typed run metadata и custom values. Завершение
асинхронного импорта входит в общий лёгкий polling операций семантики и меняет
локальную revision таблицы: запросы, общий счётчик и дерево папок обновляются
без перезагрузки страницы.
режим `SKIP_EXISTING` оставляет найденные дубли в прежних папках, а
`OVERWRITE_MAPPED` удаляет прежние membership и переносит дубль в выбранную
папку. Chunk hash строится из канонической формы SEO import row, поэтому
optional `groupPath`/frequency fields не зависят от порядка ключей JSON.
При confirm
можно оставить одну общую папку, автоматически создать подпапки по исходным
Wordstat-фразам либо задать существующую папку для отдельных preview-строк;
row override имеет приоритет над общей раскладкой. Arsenkin
submit marker fenced; известный task только poll-ится, а неизвестный transport
outcome не приводит к повторному платному `set`. Wordstat expansion делит общий
предел пяти Arsenkin provider tasks с позициями, частотностью, ИИ-ответами и
кластеризацией. Additive migration
`backend-execution/prisma/migrations/20260826160000_keys_so_wordstat_expansion`
обобщает существующий Keys.so staging без нового deployable или очереди, а
`20260826173000_arsenkin_keyword_research_capability` добавляет отдельную
`KEYWORD_RESEARCH` capability обоим Wordstat-провайдерам, XMLStock completion
fence и безопасный backfill project routes, а additive migration
`20260826190000_keyword_research_row_destinations` хранит режим раскладки run
и необязательную целевую папку preview-строки. Runtime-роль `jobs_connector`
получает только точные `EXECUTE` ACL на claim, page/XMLStock completion,
Arsenkin submit/transition и fail broker-функции; прямой доступ к таблицам
по-прежнему запрещён и проверяется инфраструктурным allowlist-тестом.

Единый `OperationResultWorkspace` обслуживает результаты частотности,
позиций, ИИ-ответов, кластеризации, технических обходов и keyword research.
Верхняя строка показывает безопасные context и actor projection, затем —
только прикладные итоговые показатели; построчная часть использует компактную
геометрию таблицы семантики и cursor/infinite scroll. Raw provider payload,
credential ID и внутренние quality codes в основной таблице не показываются.

Охват запросов в мастерах позиций/частотности/Wordstat сначала получает точный
distinct count запросом `limit=1`, а допустимый набор materialize-ится одним
union по папкам страницами по 1000. Это убирает прежний N-folders × pages
обход. Если пользователь ещё не владеет workspace, tenant switcher показывает
в popover явное действие создания и ведёт в существующий onboarding, даже при
наличии членства в областях других владельцев.

### Минус-слова, неявные дубли и карточка запроса

`Keyword.note` хранит ограниченную 4 000 символами проектную заметку; list
projection отдаёт только `hasNote`, а полный текст доступен через tenant-scoped
keyword insights. Те же insights объединяют `current_ranks` с последними 240
append-only `rank_snapshots`, поэтому график не создаёт отдельную историю и не
перезаписывает результаты съёма.

Пресеты минус-слов принадлежат Core SEO и хранят до 1 200 нормализованных слов;
additive migration `20260820213000_negative_keyword_preset_limit` синхронно
расширяет тот же DB CHECK без изменения данных. Web дополняет проектные пресеты
встроенными read-only шаблонами: один список из 1 096 уникальных названий 1 117
городов России, единый список «города + регионы», отдельный набор регионов и
узкие наборы информационного спроса, загрузок, работы и объявлений. Любой
шаблон требует preview и может быть сохранён как копия в проект. Snapshot городов находится в
`frontend/lib/russian-city-names.generated.ts`; состав и правила — в
`frontend/lib/semantic-negative-keyword-presets.ts`.
Режимы совместимы с основным workflow Key Collector: быстрое и улучшенное
русскоязычное сопоставление словоформ, полное слово/фраза, подстрока и точное
совпадение всей фразы. Для стоп-фраз отдельно сохраняются флаги игнорирования
порядка слов и пунктуации; прежние пресеты после additive migration получают
оба значения `false` и не меняют поведение. Scope можно задать всем проектом,
optimistic selection либо union до 2 000 выбранных папок. Web разворачивает
выбранных родителей до всех вложенных папок, а Core устраняет повторное
попадание запроса через несколько membership. Применение всегда двухфазное:
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
проектом, union до 2 000 выбранных папок или optimistic selection; Web
раскрывает выбранных родителей до полного набора вложенных папок, а Core
устраняет повторное попадание запроса через несколько membership. Синхронный
анализ не сканирует больше 50 000 активных строк. Preview отдаёт группы страницами по 100
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
Модалки минус-слов и неявных дублей используют стандартный закреплённый footer:
сводка области и результата остаётся слева, компактные действия — справа и не
занимают отдельную строку в прокручиваемом содержимом.

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
Scope `FOLDER_MAP` переиспользует тот же Job и read boundary: manifest хранит
выбранные UUID папок и флаг включения потомков, worker сверяет их с актуальным
деревом `keyword-groups`, исключает системные узлы и строит относительный
pre-order. XLSX получает первым листом `Карта` со вложенностью и внутренними
ссылками, а затем по одному листу на каждую непустую папку; запросы читаются
отдельно по прямому membership каждой папки, поэтому multi-group запрос может
встретиться на нескольких листах. На листах используются выбранные export
columns и обязательный `query`, в первой строке есть ссылка возврата на карту.
Пустые папки остаются только в карте. Имена листов очищаются, ограничиваются 31
символом и дедуплицируются; новый storage path, queue, deployable или таблица
не добавлены.
Режим XLSX «История позиций» использует тот же Job, очередь и storage path, но
по умолчанию выбирает только `isTracked = true`; явная настройка экспорта может
включить выключенные запросы. Режим читает через отдельный bounded read service
все BYOK-снимки выбранных
поисковиков независимо от tracking context. Worker делает два постраничных
прохода: сначала определяет фактические даты, затем потоково формирует отдельные
листы Яндекс/Google. В книге есть формулы TOP-5/10/30; позиции записываются
числами, отсутствие — прочерком. Улучшение и первое появление окрашиваются
зелёным, ухудшение и пропажа — красным, неизменное значение и отсутствие без
предыдущего замера остаются нейтральными. Новые queue, deployable или таблица
для этого режима не добавлены.
Обычный экспорт таблицы поддерживает четыре export-only колонки: URL
SERP-конкурентов, их `Title` / `Description`, URL ИИ-конкурентов и их
`Title` / `Description`. SEO-owned bounded read service
`semantic-competitor-export.service.ts` и internal endpoint
`/internal/v1/projects/:projectId/semantic-exports/competitors` постранично
обогащают те же строки запросов последним сохранённым XMLStock/Arsenkin SERP и
последним Arsenkin AI-answer snapshot с источниками отдельно для каждого
keyword/search engine. Собственный домен проекта исключается, одинаковые
нормализованные URL дедуплицируются внутри одного keyword и источника. Один
keyword остаётся одной строкой файла; несколько URL и SERP-блоков разделяются
переводами строк внутри соответствующей ячейки. CSV/TSV экранируют такие ячейки,
XLSX использует wrap-text; отдельный режим, queue, таблица или deployable не
добавлены.
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
- Workspace override удерживает транзитивный Prisma CLI dependency
  `mysql2@3.24.2` на исправленной ветке; runtime приложения использует только
  PostgreSQL, но production dependency graph всё равно обязан проходить audit.
- `.env.example` содержит только имена и безопасные placeholders.
- Redis разделён на durable Jobs (`AOF`, `noeviction`) и ephemeral Realtime
  Pub/Sub/TTL presence; named users ограничены versioned key/channel
  namespaces. Realtime runtime имеет key access только к
  `seo-platform:realtime:v1:presence:*` и не может читать произвольные ключи.
- Все application processes работают в UTC.
- Production template включает S3 и inspection. S3 objects физически
  изолируются неизменяемым `S3_KEY_PREFIX`, при этом в Jobs DB хранится
  логический object key. Inspection, Web Push, YooKassa и provider paths могут
  быть явно выключены; недоступная функция не имитирует успех.
- Инструкция развёртывания: `infrastructure/DOKPLOY.md`.
- Secrets, application S3 и четыре PostgreSQL backup job:
  `infrastructure/DOKPLOY-SECRETS.md`.
- Telegram alert rollout/canary:
  `infrastructure/runbooks/operational-alerts.md`.
- Local production-like runtime: `infrastructure/vps/README.md`.
- Мутирующий public API security smoke:
  `infrastructure/vps/smoke-public-api.sh`; он запускается только с явным
  `SEO_PLATFORM_API_SMOKE_CONFIRM=CREATE_TEST_DATA`, создаёт изолированные
  синтетические tenant-данные и проверяет token lifecycle, scope/project/
  cross-tenant boundaries, cookie-denied identifier discovery, семантику,
  rank estimate/run и общий порядок проектов без вывода plaintext token.

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
  успешного Telegram canary и проверенных backup/restore drills.
- Platform-paid XMLStock/Arsenkin остаётся выключенным до внешних legal и
  provider gates, заполнения hard budget, balance alert и fault-injection canary окна
  provider-response → Core settlement. В этом окне пользователь не
  списывается и локальный outcome не сохраняется, но provider cost уже мог
  возникнуть.
- Dokploy database backups являются logical dump; PostgreSQL PITR/WAL остаётся
  отдельным production hardening шагом при более строгом RPO.
- Если измерения потребуют независимого масштабирования отдельной child role,
  тот же artifact можно снова запустить отдельным process profile без возврата
  старых исходных каталогов.

Карту обновляют при изменении deployable, process role, data ownership,
очереди/события, базы, обязательной конфигурации или startup topology.
