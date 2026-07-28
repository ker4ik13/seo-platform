# @seo-platform/contracts

Единый пакет HTTP, health и event contracts.

Правила:

- не содержит бизнес-логики и доступа к инфраструктуре;
- breaking change требует новой версии контракта;
- сервисы не копируют определённые здесь error/event types;
- runtime JSON Schema/OpenAPI будут добавляться вместе с первым вертикальным API.
