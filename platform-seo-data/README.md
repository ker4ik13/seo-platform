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
- `GET .../rank-manifests/:manifestId/chunks/:chunkIndex?jobId=...`;
- `POST .../rank-manifests/:manifestId/finalize`.

Запись уже нормализованных результатов имеет отдельный write credential
`JOBS_TO_SEO_RANK_RESULT_TOKEN` / `X-Rank-Result-Token` и не даёт читать
plaintext chunks:

- `POST .../rank-manifests/:manifestId/chunks/:chunkIndex/results`.

Bounded internal history read использует обычный trusted internal context:

- `GET /internal/v1/projects/:projectId/rank-history`.

`RANK_HISTORY_CURSOR_KEY` используется только SEO Data для HMAC-аутентификации
tenant/filter-bound opaque cursor. Текущий Compose fail-closed требует result
token и cursor key, но передаёт их только `seo-data`; producer результатов
ещё не подключён.

Estimate и seal сначала читают только bounded SQL-агрегаты размера scope.
Тексты материализуются лишь для не более 1 000 фраз, каждая до 500 Unicode
code points / 2 000 UTF-8 bytes. Manifest строится в одной Repeatable Read
транзакции, переходит `BUILDING → SEALED`, а БД запрещает неполную фиксацию,
поздние child inserts, переписывание и удаление. После обработки допустим
только однократный lifecycle-переход `SEALED → CLOSED`.

Seal хранит срок действия estimate и для нового manifest отклоняет
`snapshotAt >= estimate.expiresAt`; exact replay уже созданного manifest
проверяется до expiry gate и остаётся доступным. Миграция hardening
останавливается fail-closed, если до её применения таблица manifest уже не
пуста: правдивого backfill для полного `rank-manifest@1` hash не существует.

Normalized result ingest валидирует exact manifest/chunk/job provenance,
записывает immutable receipt, append-only rank snapshots и monotonic current
projection под одним manifest lock. Duplicate exact command возвращает
исходную receipt, late ingest после `CLOSED` запрещён.

Finalize сериализуется тем же manifest lock. После полного согласованного
набора ingest receipts он поддерживает `COMPLETED` и
`PARTIALLY_COMPLETED`; zero-result `CANCELLED`, `FAILED` и
`ACTION_REQUIRED` также закрываются атомарно. Exact replay возвращает
исходную immutable receipt, конфликтующий terminal outcome отклоняется.
Успешный/partial finalize пишет redacted completion outbox в той же
транзакции; durable publisher всё ещё отсутствует.

Список контекстов ограничен 200 агрегатами и возвращает
`contextsTruncated`. Список назначений использует связанный с контекстом и
поиском непрозрачный keyset cursor. `SemanticKeywordListItem.isTracked`
вычисляется по активным назначениям активных контекстов; колонка
`keywords.is_tracked` не является источником истины.

Прямого browser/public доступа к SEO Data нет. Авторизованный public read
доступен через Platform API
`GET /api/v1/projects/:projectId/rank-history`, который повторно проверяет
scope/filter/order/page coherence и redact-ит ответ. Private/noindex Web UI
работает только через same-origin BFF и этот gateway route.

`rank_snapshots` первого normalized slice пока не partitioned; RANGE
partitioning/maintenance и representative history load test остаются release
gates. Готовый read proxy не является доказательством production-scale
storage.
