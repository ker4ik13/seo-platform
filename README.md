# Infrastructure / Dokploy

`compose.dokploy.yml` — первый удалённый контур. Он рассчитан на одну VPS:

- PostgreSQL 18 с отдельными databases для четырёх backend-контуров и Directus;
- Redis с AOF для BullMQ, Socket.IO и cache;
- NATS с JetStream;
- четыре NestJS API, отдельный system worker;
- единый web (`/`, `/tools`, `/docs`, `/app`), admin и Directus;
- S3 и SMTP подключаются как внешние managed/hosted сервисы.

## Первый запуск

1. Создать в Dokploy Compose-проект из корня репозитория.
2. Скопировать переменные из корневого `.env.example`, заменить все
   `replace-me`, URL и версии юридических документов.
3. Сначала оставить `S3_ENABLED=false`, `EMAIL_ENABLED=false`,
   `DIRECTUS_STORAGE_DRIVER=local`.
4. Привязать основной домен к `web:3000`, остальные домены к `admin:3002`,
   `platform-api:4000`, `realtime:4003`, `directus:8055`.
5. Развернуть compose. Migration services завершаются до запуска приложений.

PostgreSQL, Redis и NATS не публикуют порты наружу. В production рекомендуется
разделить credentials баз данных по сервисам; один кластер на старте сохраняет
изоляцию databases без лишней эксплуатационной нагрузки.

Для official PostgreSQL 18 volume намеренно смонтирован в
`/var/lib/postgresql`: начиная с 18 это новый persistent volume root. Не
возвращать старый путь `/var/lib/postgresql/data`.

`AUTH_*_COOKIE_NAME` должны быть одинаковыми у `web` и `platform-api`.
Имя CSRF cookie встраивается в browser bundle на build, поэтому его изменение
требует пересборки Web. Содержимое cookie, access token и session token в
frontend bundle не попадают.

## Подключение S3 и email

Для application uploads заполнить `S3_*` и включить `S3_ENABLED=true`.
Directus можно перевести на тот же S3-провайдер с отдельным bucket:
`DIRECTUS_STORAGE_DRIVER=s3`, `S3_BUCKET_CMS=...`.

Application bucket должен разрешать CORS только с origin основного Web:

- методы `PUT`, `GET`, `HEAD`;
- request headers, используемые S3-подписью;
- response header `ETag` в `ExposeHeaders`;
- короткий `MaxAgeSeconds`, соответствующий политике провайдера.

Wildcard origin с credentials запрещён. Signed URL передаётся только клиенту,
не логируется и истекает по `S3_SIGNED_URL_TTL_SECONDS`. Для bucket обязательно
настроить lifecycle: abort incomplete multipart uploads через 2 дня и
retention/удаление quarantine и временных объектов по продуктовой политике.
Периодический reconciliation job дополнительно закрывает просроченные записи
и orphan objects; bucket lifecycle остаётся последней линией защиты.

Для писем приложения заполнить SMTP-переменные и включить
`EMAIL_ENABLED=true`. Для Directus дополнительно установить
`DIRECTUS_EMAIL_TRANSPORT=smtp`. До этого оба контура остаются работоспособными,
но не отправляют письма.

## Масштабирование

API, SEO data, jobs API, workers, realtime и Next.js stateless на уровне
контейнера. Реплики worker/realtime можно увеличивать независимо. Persistent
state находится в PostgreSQL, Redis, NATS JetStream и S3. Перед production
нужны внешние backups, alerting и проверенный restore runbook.

`platform-web` является одним repository/image. При росте одно image можно
запустить отдельными public/app runtime profiles и направить `/app` в
изолированный pool через Traefik, не возвращаясь к двум расходящимся frontend.
