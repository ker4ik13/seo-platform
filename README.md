# platform-seo-data

Владелец семантики, страниц, позиций и производных SEO-данных.

Foundation содержит:

- изолированную Prisma schema;
- append-only snapshots и current-rank projection;
- NATS connection;
- liveness/readiness;
- internal capability endpoint.

Публичного доступа нет: запросы приходят только через `platform-api`.
