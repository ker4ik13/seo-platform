# Frontend

Единый Next.js deployable SEOньориты:

- public/localized marketing routes;
- индексируемый `/tools` и `/docs`;
- private/no-store приложение `/app`;
- защищённая operations-панель `/admin`;
- same-origin BFF `/app/api/**` и `/admin/api/**` к `backend-core`.

Маркетинговый контент текущей версии типизирован в `lib/content.ts` и не
зависит от внешнего CMS. Browser не получает internal service credentials;
session, CSRF, workspace/project и permissions авторитетно проверяет backend.

```bash
pnpm --filter @seo-platform/frontend typecheck
pnpm --filter @seo-platform/frontend test
pnpm --filter @seo-platform/frontend build
```
