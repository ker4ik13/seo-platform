# Unified web

Единый Next.js web-продукт, порт `3000`:

- публичный локализованный сайт и статьи;
- индексируемый Toolbox в `/tools`;
- API-документация в `/docs/api`;
- защищённое, неиндексируемое приложение в `/app`.

Контент читается из Directus с типизированным fallback. Directus не имеет
доступа к данным приложения. Public/project Toolbox и публичный API используют
общий capability registry и backend handlers.

`/app` сейчас показывает foundation dashboard с безопасными demo data при
недоступном Platform API. Tenant auth будет подключён следующим вертикальным
срезом; route уже имеет noindex/no-store headers.
