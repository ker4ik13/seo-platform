# ADR-2026-044: Arsenkin clustering через durable proposal

- Статус: принято
- Дата: 20 августа 2026 года
- Затронутые области: Contracts, Core API, Core SEO, Execution, Frontend,
  PostgreSQL ACL
- Изменение API/БД: новый `CLUSTERING_RUN`; новые SEO-таблицы
  `clustering_proposals`, `clustering_proposal_clusters`,
  `clustering_proposal_items`, bounded JSONB `top_urls`; новые public/internal
  endpoints и fenced Jobs routines

## Контекст

Кластеризация по выдаче является долгой внешней операцией и не может менять
папки и кластеры непосредственно из provider callback. Между расчётом и
применением пользователь может изменить запрос, заблокировать кластер или
поменять структуру папок. Повтор внешнего `set` после transport timeout также
может дважды списать лимит Arsenkin.

Jobs владеет execution lifecycle, credential routing и provider request, а SEO
владеет запросами, папками, кластерами и semantic history. Перенос proposal в
Jobs нарушил бы data ownership и заставил бы Jobs принимать решения о текущем
состоянии семантики; прямое применение из worker лишило бы пользователя
preview и conflict review.

## Решение

- Execution владеет отдельным Job type `CLUSTERING_RUN`, фиксирует exact
  versioned keyword scope и параметры Arsenkin.
- Exact scope ограничен 300 000 запросов на всех command/broker/storage
  boundaries. Крупные тела разрешены только на точных clustering routes;
  остальные HTTP routes сохраняют общий малый body limit.
- Connector вызывает `clustering` через `set/check/get`. Submit marker,
  lease/version predicates и exact item set сохраняются в fenced
  `SECURITY DEFINER` routines. Неоднозначный submit не повторяется
  автоматически и требует reconciliation.
- Rank, Wordstat, AI answer и clustering используют один глобальный предел
  пяти активных Arsenkin provider tasks. Clustering переиспользует быстрый
  connector dispatch queue, но остаётся отдельной пользовательской операцией и
  отдельным durable Job.
- Core SEO владеет immutable входным результатом как versioned proposal.
  Provider rows не являются текущими `Cluster`/`KeywordGroup` до явного apply.
- Result boundary повторно вычисляет состояния строк относительно текущих
  keyword versions и locked/excluded clusters.
- Apply является одной tenant-scoped SEO-транзакцией. Пользователь выбирает
  proposed clusters, задаёт названия и для каждого выбирает новую папку,
  существующую папку либо сохранение текущих membership. Действие `NEW` может
  передавать собственный project-scoped `parentGroupId` конкретного кластера;
  без него папка создаётся в корне. Отдельный keyword override имеет приоритет.
  Сервис повторно проверяет versions, destination folders, permissions и
  folder entitlement, создаёт semantic history и атомарно помечает proposal
  применённым.
- Новая или существующая destination folder означает перенос и удаляет прежние
  обычные membership; `KEEP` оставляет их без изменений. Существующие
  SEO-кластеры заменяются только если это явно разрешено во входных параметрах
  запуска.
- Reject закрывает proposal без доменных изменений. Apply/reject используют
  proposal version и являются terminal.
- External raw response, API key и provider task ID не выдаются браузеру;
  UI получает только нормализованные bounded поля.

## Миграция и совместимость

SEO migration добавляет proposal tables, bounded массив нормализованных URL-
доказательств и включает root receipt в allowlist
переноса проекта; дочерние строки следуют за ним по cascade. Composite foreign
key запрещает item ссылаться на cluster другого proposal. Execution migration
добавляет четыре fenced routines и расширяет существующие Arsenkin capacity
predicates. Connector role получает только exact `EXECUTE`, без table DML.

Старые Jobs и semantic entities не меняются. Новые semantic cluster methods
`ARSENKIN_SOFT|ARSENKIN_HARD` расширяют общий contract; `MANUAL` сохраняет
прежнюю семантику.

## Последствия и rollback

Provider completion и применение пользователем становятся двумя видимыми
этапами. Это добавляет SEO storage и один review step, но предотвращает
неожиданную перестройку проекта и сохраняет полный журнал решения.

Application rollback возможен до первого использования новых routes. После
создания proposal таблицы остаются совместимым неиспользуемым receipt storage;
удалять их автоматически нельзя. Для полного rollback сначала отключается
создание `CLUSTERING_RUN`, дожидаются terminal активных Jobs, снимаются exact
connector grants/functions и только отдельной проверенной миграцией удаляются
proposal tables/type.
