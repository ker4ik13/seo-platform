# Развёртывание лендинга SEOньорита

Лендинг находится в ветке `codex/seonorita-landing`. Он не требует
Platform API, PostgreSQL, Redis или других сервисов для публичных маршрутов
`/ru` и `/en`.

## 1. Настройка

Создайте серверный `.env` рядом с корневым `package.json`:

```dotenv
LANDING_PUBLIC_URL=https://example.com
TELEGRAM_CHANNEL_URL=https://t.me/seonorita_app
DEFAULT_LOCALE=ru
LANDING_BIND_ADDRESS=127.0.0.1
LANDING_PORT=3000
```

`LANDING_PUBLIC_URL` используется для canonical, Open Graph, robots.txt и
sitemap. После получения адреса Telegram-канала достаточно изменить
`TELEGRAM_CHANNEL_URL` и пересобрать контейнер. Production-default уже ведёт
в официальный канал `https://t.me/seonorita_app`; контакт разработчика в
футере остаётся отдельной ссылкой `https://t.me/ker4ik13`.

## 2. Dokploy через Git и Nixpacks

Создайте в Dokploy новое приложение со следующими параметрами:

- Repository: `https://github.com/ker4ik13/seo-platform.git`;
- Branch: `codex/seonorita-landing`;
- Build Type: `Nixpacks`;
- Base Directory: `/`;
- Install Command: `corepack enable && pnpm install --frozen-lockfile`;
- Build Command: `npm run build`;
- Start Command: `npm start`;
- Port: `3000`;
- Health Check Path: `/ru`.

Переменные приложения в Dokploy:

```dotenv
NODE_ENV=production
PORT=3000
DEFAULT_LOCALE=ru
NEXT_PUBLIC_SITE_URL=https://example.com
NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=https://t.me/seonorita_app
```

Обе переменные `NEXT_PUBLIC_*` должны быть заданы **до build**, иначе
статические canonical, sitemap и Telegram CTA будут собраны с fallback.
После привязки домена выполните Redeploy, чтобы в build попал окончательный
HTTPS URL.

Стандартные scripts запускаются из корня репозитория:

```bash
npm run dev
npm run build
npm start
```

Стандартный `npm run dev` является alias для `dev:landing`, а полный build
всех сервисов monorepo сохранён как `npm run build:all`. `npm start` не
выполняет build автоматически и уважает `PORT`, переданный Dokploy. Пакетный
менеджер workspace остаётся pinned `pnpm@11.17.0`; npm в командах выше только
вызывает scripts из корневого `package.json`.

## 3. Запуск через Docker Compose

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

## 4. Caddy

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

## 5. Запуск без Docker

Требуются Node.js 24 и pnpm 11.17:

```bash
corepack enable
pnpm install --frozen-lockfile
npm run build
npm start
```

Переменные `NEXT_PUBLIC_SITE_URL` и
`NEXT_PUBLIC_TELEGRAM_CHANNEL_URL` необходимо передать на этапе build.

## 6. Проверки перед публикацией

```bash
npm run check:landing
pnpm exec oxlint platform-web/app platform-web/lib platform-web/next.config.ts \
  --import-plugin --react-plugin --promise-plugin --node-plugin --deny-warnings
npm run build
```

После запуска проверьте `/ru`, `/en`, `/robots.txt`, `/sitemap.xml`,
`/manifest.webmanifest` и `/opengraph-image`.
