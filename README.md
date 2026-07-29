# platform-seo-data

Владелец семантики, страниц, позиций и производных SEO-данных.

Foundation содержит:

- изолированную Prisma schema;
- append-only snapshots и current-rank projection;
- NATS connection;
- liveness/readiness;
- internal capability endpoint.

Контексты отслеживания:

- логический контекст с optimistic concurrency (`version`);
- неизменяемые версии поисковой конфигурации;
- временные назначения ключей без hard delete;
- точный replay создания по idempotency key;
- архивирование и восстановление вместо удаления;
- tenant-safe составные внешние ключи;
- транзакционные redacted outbox-события.

Внутренний API доступен только с internal token и доверенным
workspace/project/actor context:

- `GET|POST /internal/v1/projects/:projectId/tracking-contexts`;
- `GET|PATCH /internal/v1/projects/:projectId/tracking-contexts/:contextId`;
- `POST .../:contextId/archive|restore`;
- `GET .../:contextId/keywords`;
- `PUT|DELETE .../:contextId/keywords/:keywordId`.

Secret-bearing rank manifest API изолирован отдельным
`JOBS_TO_SEO_RANK_TOKEN` и заголовком `X-Rank-Execution-Token`; общий
internal token его не открывает:

- `POST /internal/v1/projects/:projectId/rank-manifests`;
- `GET .../rank-manifests/:manifestId/chunks/:chunkIndex?jobId=...`.

Estimate и seal сначала читают только bounded SQL-агрегаты размера scope.
Тексты материализуются лишь для не более 1 000 фраз, каждая до 500 Unicode
code points / 2 000 UTF-8 bytes. Manifest строится в одной Repeatable Read
транзакции, переходит `BUILDING → SEALED`, а БД запрещает неполную фиксацию,
поздние child inserts, переписывание и удаление. После обработки допустим
только однократный lifecycle-переход `SEALED → CLOSED`.

Список контекстов ограничен 200 агрегатами и возвращает
`contextsTruncated`. Список назначений использует связанный с контекстом и
поиском непрозрачный keyset cursor. `SemanticKeywordListItem.isTracked`
вычисляется по активным назначениям активных контекстов; колонка
`keywords.is_tracked` не является источником истины.

Публичного доступа нет: запросы приходят только через `platform-api`.
