# platform-api

Публичный API gateway и владелец identity/workspace/project/billing данных.

## Текущий foundation

- Fastify/NestJS bootstrap;
- strict env validation;
- PostgreSQL 18 / Prisma 7 foundation schema;
- liveness/readiness;
- readiness orchestration к трём внутренним backend-сервисам;
- публичный capability descriptor.

Бизнес-endpoints не публикуются до реализации auth, tenant context и permissions.
