# @seo-platform/contracts

Единый пакет HTTP, health и event contracts.

Правила:

- не содержит бизнес-логики и доступа к инфраструктуре;
- breaking change требует новой версии контракта;
- сервисы не копируют определённые здесь error/event types;
- runtime JSON Schema/OpenAPI будут добавляться вместе с первым вертикальным API.

Server-only subpaths:

- `@seo-platform/contracts/canonical-json` — RFC 8785 JCS и базовые SHA-256
  helpers;
- `@seo-platform/contracts/rank-results-canonical` — exact preimage/hash
  builders для normalized rank ingest, finalize и history cursor filter.

Эти subpaths импортируют Node.js crypto и не экспортируются из browser/root
entrypoint.
