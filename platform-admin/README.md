# Operations admin

Защищённая административная панель приложения, Next.js App Router, порт
`3002`. Она не заменяет Directus.

Реализованы:

- вход через общую session identity с обязательным MFA и недавней
  аутентификацией;
- persisted platform roles и безопасный bootstrap первого `SUPER_ADMIN`;
- очередь обязательств по чекам НПД, расшифровка buyer snapshot только для
  `FINANCE`, регистрация официального чека, аннулирование после полного
  возврата и замена после частичного возврата;
- отдельный audit всех PII-просмотров и финансовых действий;
- same-origin BFF с закрытым allowlist маршрутов.

Первый super admin создаётся после регистрации, подтверждения email и
включения TOTP:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@example.com \
ADMIN_BOOTSTRAP_REASON='Initial production owner' \
ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_SUPER_ADMIN \
pnpm --filter @seo-platform/platform-api admin:bootstrap
```

Bootstrap откажется работать, если уже существует хотя бы одно активное
назначение platform role.
