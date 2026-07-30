# Unified web

Единый Next.js web-продукт, порт `3000`:

- публичный локализованный сайт и статьи;
- индексируемый Toolbox в `/tools`;
- API-документация в `/docs/api`;
- защищённое, неиндексируемое приложение в `/app`.

Публичная главная в ветке `codex/seonorita-landing` оформлена как
двуязычный pre-launch лендинг бренда **SEOньорита / SEOnorita**. Она
показывает целевую карту возможностей и честный roadmap, не объявляя ещё не
выпущенные функции готовыми. Telegram CTA задаётся через
`NEXT_PUBLIC_TELEGRAM_CHANNEL_URL`; инструкция автономного запуска на VPS и
Caddy находится в [`LANDING_DEPLOYMENT.md`](./LANDING_DEPLOYMENT.md).
Для Dokploy/Nixpacks из корня используются стандартные команды
`npm run build` и `npm start`; Web читает назначенный платформой `PORT` без
hard-coded CLI-флага. Полная monorepo-сборка сохранена как `npm run build:all`.

Контент читается из Directus с типизированным fallback. Directus не имеет
доступа к данным приложения. Public/project Toolbox и публичный API используют
общий capability registry и backend handlers.

`/app` использует same-origin BFF `/app/api/**`: browser cookies не передаются
в JavaScript, CSRF header проверяется Platform API, а Server Components
получают tenant context через внутреннюю сеть. Реализованы регистрация, вход,
подтверждение email, безопасное восстановление пароля, refresh redirect, выход,
MFA challenge, настройка TOTP/recovery codes в профиле, создание/выбор
workspace и проекта. Неподключённые SEO-данные показываются честными empty
states, а не демонстрационными значениями.

Rankings UI разделён на private/noindex контексты и историю. Route
`/app/projects/:projectId/rankings` читает только public Platform API через
same-origin BFF, поддерживает UTC date range, context/keyword filters,
cursor load-more, loading/empty/error/offline и archived/read-only states.
`JOBS_TO_SEO_RANK_RESULT_TOKEN` и `RANK_HISTORY_CURSOR_KEY` Web не получает.
История показывает только сохранённые normalized observations: execution
grant, live provider submit/status и result producer ещё отсутствуют, поэтому
экран не означает готовность реального сбора.

Экран `/app/semantics` поддерживает прямую multipart-загрузку CSV/TSV/XLS/
XLSX/ZIP в S3, прогресс, ограниченную параллельность, повтор parts,
возобновление после перезагрузки вкладки и явную отмену. Файл не публикуется
до серверной проверки и import preview.

Имена auth cookies в Web и Platform API должны совпадать. Публичная зона,
Toolbox и API docs не зависят от пользовательской сессии.
