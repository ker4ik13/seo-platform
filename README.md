# platform-api

Публичный API gateway и владелец identity/workspace/project/billing данных.

## Реализовано

- Fastify/NestJS bootstrap;
- strict env validation;
- PostgreSQL 18 / Prisma 7 foundation schema;
- liveness/readiness;
- readiness orchestration к трём внутренним backend-сервисам;
- публичный capability descriptor;
- email/password registration и обязательные consent snapshots;
- Argon2id password hashing с production pepper;
- одноразовая email verification;
- login/logout и server-side session inventory;
- opaque cookie session rotation и token-family replay revocation;
- session-bound CSRF;
- PostgreSQL rate limiting по IP/account fingerprint;
- audit и transactional outbox.

Identity endpoints доступны под `/api/v1/auth/*`, `/api/v1/me` и
`/api/v1/sessions`. Tenant API публикует:

- `/api/v1/workspaces`;
- `/api/v1/workspaces/{workspaceId}`;
- `/api/v1/workspaces/{workspaceId}/projects`;
- `/api/v1/projects/{projectId}`;
- `/api/v1/projects/{projectId}/archive|restore`.

Tenant endpoints используют default-deny permission catalog, проверенное
membership, CSRF для команд и `If-Match`/`ETag` для конкурентных изменений.

Production требует `AUTH_PASSWORD_PEPPER`, `AUTH_COOKIE_SECURE=true` и
`AUTH_EXPOSE_DEVELOPMENT_TOKENS=false`. Verification token передаётся email
worker через transactional outbox; он не логируется.
