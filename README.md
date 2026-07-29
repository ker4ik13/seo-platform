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

Список контекстов ограничен 200 агрегатами и возвращает
`contextsTruncated`. Список назначений использует связанный с контекстом и
поиском непрозрачный keyset cursor. `SemanticKeywordListItem.isTracked`
вычисляется по активным назначениям активных контекстов; колонка
`keywords.is_tracked` не является источником истины.

Публичного доступа нет: запросы приходят только через `platform-api`.
