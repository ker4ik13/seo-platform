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
- безопасное восстановление пароля с единообразным ответом, TTL и отзывом
  прежних сессий;
- TOTP 2FA, одноразовые recovery codes, MFA login challenge и шифрование
  секретов AES-256-GCM;
- login/logout и server-side session inventory;
- opaque cookie session rotation и token-family replay revocation;
- session-bound CSRF;
- PostgreSQL rate limiting по IP/account fingerprint;
- audit и transactional outbox;
- workspace/project CRUD с project-scoped permission narrowing;
- участники, одноразовые приглашения, отзыв доступа и optimistic locking;
- project-scoped multipart upload API с проверкой `file.upload`,
  `Idempotency-Key` и проксированием команд во внутренний jobs-контур.

Identity endpoints доступны под `/api/v1/auth/*`, `/api/v1/me` и
`/api/v1/sessions`. Tenant API публикует:

- `/api/v1/workspaces`;
- `/api/v1/workspaces/{workspaceId}`;
- `/api/v1/workspaces/{workspaceId}/members`;
- `/api/v1/workspaces/{workspaceId}/invites`;
- `/api/v1/workspace-invites/accept`;
- `/api/v1/workspaces/{workspaceId}/projects`;
- `/api/v1/projects/{projectId}`;
- `/api/v1/projects/{projectId}/archive|restore`;
- `/api/v1/projects/{projectId}/uploads/*`.

Tenant endpoints используют default-deny permission catalog, проверенное
membership, CSRF для команд и `If-Match`/`ETag` для конкурентных изменений.

Production требует `AUTH_PASSWORD_PEPPER`, `AUTH_COOKIE_SECURE=true` и
`AUTH_EXPOSE_DEVELOPMENT_TOKENS=false`. Verification token передаётся email
worker как ссылка на одноразовую запись: открытый token детерминированно
восстанавливается внутри доверенного контура и не попадает в outbox или логи.
То же правило применяется к приглашениям в workspace и восстановлению пароля.

Для внутренних upload-команд Platform API и jobs API используют отдельный
`INTERNAL_API_TOKEN`. Он обязателен и должен содержать не менее 32 символов в
production. При read-only billing state просмотр и разрешённый экспорт
остаются доступны, а создание нового импорта блокируется.

Production дополнительно требует отдельный 32-байтный
`AUTH_DATA_ENCRYPTION_KEY` в Base64URL для TOTP secrets. Смена этого ключа
выполняется отдельной процедурой re-encryption, а не простой заменой env.
