# Развёртывание лендинга SEOньорита

Лендинг находится в ветке `codex/seonorita-landing`. Он не требует
Platform API, PostgreSQL, Redis или других сервисов для публичных маршрутов
`/ru` и `/en`.

## 1. Настройка

Создайте серверный `.env` рядом с корневым `package.json`:

```dotenv
LANDING_PUBLIC_URL=https://example.com
TELEGRAM_CHANNEL_URL=https://t.me/your_channel
DEFAULT_LOCALE=ru
LANDING_BIND_ADDRESS=127.0.0.1
LANDING_PORT=3000
```

`LANDING_PUBLIC_URL` используется для canonical, Open Graph, robots.txt и
sitemap. После получения адреса Telegram-канала достаточно изменить
`TELEGRAM_CHANNEL_URL` и пересобрать контейнер. До этого CTA безопасно ведёт
на контакт разработчика `https://t.me/ker4ik13`.

## 2. Запуск через Docker Compose

Из корня репозитория:

```bash
docker compose \
  --env-file .env \
  -f platform-infrastructure/compose.landing.yml \
  up -d --build
```

Проверка состояния:

```bash
docker compose \
  --env-file .env \
  -f platform-infrastructure/compose.landing.yml \
  ps

curl --fail --show-error http://127.0.0.1:3000/ru
```

Контейнер слушает только loopback VPS по умолчанию. Наружу его публикует
reverse proxy.

## 3. Caddy

Замените домен и добавьте блок в Caddyfile:

```caddyfile
example.com, www.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Перед reload проверьте конфигурацию:

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Production-домен должен совпадать с `LANDING_PUBLIC_URL`. HTTPS выдаётся и
обновляется Caddy автоматически после корректной настройки DNS.

## 4. Запуск без Docker

Требуются Node.js 24 и pnpm 11.17:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @seo-platform/contracts build
pnpm --filter @seo-platform/web build
pnpm --filter @seo-platform/web start
```

Переменные `NEXT_PUBLIC_SITE_URL` и
`NEXT_PUBLIC_TELEGRAM_CHANNEL_URL` необходимо передать на этапе build.

## 5. Проверки перед публикацией

```bash
pnpm --filter @seo-platform/contracts build
pnpm --filter @seo-platform/web typecheck
pnpm --filter @seo-platform/web test
pnpm exec oxlint platform-web/app platform-web/lib platform-web/next.config.ts \
  --import-plugin --react-plugin --promise-plugin --node-plugin --deny-warnings
pnpm --filter @seo-platform/web build
```

После запуска проверьте `/ru`, `/en`, `/robots.txt`, `/sitemap.xml`,
`/manifest.webmanifest` и `/opengraph-image`.
