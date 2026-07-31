# Unified web

Единый Next.js web-продукт, порт `3000`:

- публичный локализованный сайт и статьи;
- индексируемый Toolbox в `/tools`;
- API-документация в `/docs/api`;
- защищённое, неиндексируемое приложение в `/app`.

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

Экран `/app/semantics` поддерживает прямую multipart-загрузку CSV/TSV/XLSX в
S3, прогресс, ограниченную параллельность, повтор parts, возобновление после
перезагрузки вкладки и явную отмену. После ClamAV/checksum/MIME-проверки
CSV/TSV потоково разбираются как delimited text, а XLSX — через bounded
OpenXML parser с первым видимым листом, cached formula values и защитой от
zip bomb. Файл не публикуется до mapping, validation preview и явного
подтверждения. Legacy XLS, ZIP из нескольких файлов и выбор листов ещё не
включены.

Имена auth cookies в Web и Platform API должны совпадать. Публичная зона,
Toolbox и API docs не зависят от пользовательской сессии.
