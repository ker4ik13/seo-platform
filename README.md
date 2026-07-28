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

Имена auth cookies в Web и Platform API должны совпадать. Публичная зона,
Toolbox и API docs не зависят от пользовательской сессии.
