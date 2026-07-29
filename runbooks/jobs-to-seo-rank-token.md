# Rollout `JOBS_TO_SEO_RANK_TOKEN`

## Назначение и граница

`JOBS_TO_SEO_RANK_TOKEN` — отдельный service credential для внутренних
rank-manifest endpoints HTTP-сервиса `seo-data`. Он защищает в том числе
чтение plaintext keyword chunks и поэтому не заменяется общим
`INTERNAL_API_TOKEN`.

В текущем deployment consumer-процесс `rank-worker` ещё отсутствует.
Разрешённый получатель ровно один:

- `seo-data` HTTP process.

Секрет запрещено передавать migration services, `jobs-integrations` HTTP,
`system-worker`, `import-worker`, `upload-inspection-worker`,
`connector-worker`, Platform API, Realtime, Web, Admin и Directus. После
реального появления отдельного `rank-worker` список может быть расширен
только этим process type с одновременным изменением regression-теста.

## Создание

Сгенерировать независимое URL-safe значение минимум из 32 символов следует
локально в защищённой административной сессии:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Значение нужно сразу сохранить в защищённом secret storage Dokploy. Реальное
значение нельзя помещать в Git, `.env.example`, CI output, тикет, URL, логи
или результат `docker compose config`. Оно обязано отличаться от всех
остальных service tokens и cryptographic keys.

## Rollout

1. Добавить `JOBS_TO_SEO_RANK_TOKEN` в environment staging Compose-проекта до
   выкладки новой версии `seo-data`.
2. Запустить статическую проверку получателей:

   ```bash
   node --test tests/rank-token-scope.test.mjs
   ```

3. Проверить раскрытие Compose только в quiet-режиме. Из каталога
   `platform-infrastructure` в monorepo:

   ```bash
   JOBS_TO_SEO_RANK_TOKEN="$(openssl rand -base64 48 | tr -d '\n')" \
   PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN="$(openssl rand -base64 48 | tr -d '\n')" \
   docker compose --env-file ../.env.example \
     -f compose.dokploy.yml config --quiet
   ```

   Без `--quiet` команду запускать запрещено: итоговая конфигурация содержит
   раскрытые production secrets.
4. Развернуть migration, затем только HTTP-процесс `seo-data`. Migration не
   получает новый secret.
5. Проверить liveness/readiness `seo-data` и отсутствие restart loop. Пустое,
   короткое или совпадающее с `INTERNAL_API_TOKEN` значение должно
   fail-closed остановить production startup.
6. Пока отдельного `rank-worker` нет, не передавать secret ни одному
   jobs-процессу. Rank execution остаётся закрытым, а остальные internal
   SEO endpoints продолжают использовать свою существующую границу.
7. Повторить те же шаги в production после успешной staging-проверки.

## Ротация

Текущий runtime принимает одно значение без overlap keyring. Пока consumer
отсутствует, ротация выполняется заменой секрета в Dokploy и rolling restart
только `seo-data`.

После появления `rank-worker` безопасная zero-downtime ротация потребует
совместимой поддержки двух токенов или координированного maintenance rollout.
Нельзя молча менять единственный токен сначала только у producer или только у
consumer: это создаст частичную недоступность manifest flow. До реализации
overlap следует:

1. остановить выдачу новых rank executions;
2. дождаться завершения либо checkpoint активных операций;
3. заменить secret у `seo-data` и всех реплик отдельного `rank-worker`;
4. перезапустить оба process type и выполнить smoke;
5. снова включить выдачу execution grants.

Старое значение хранится только в защищённом rollback window и удаляется
после подтверждения здоровья всех новых replicas.

## Rollback и incident

- Если новый `seo-data` не стартует, вернуть предыдущее значение из
  защищённого secret store и предыдущий immutable image tag. Изменений данных
  этот rollout не требует.
- При подозрении на утечку немедленно закрыть новые rank executions,
  сгенерировать независимый replacement, выполнить ротацию и проверить access
  logs только по redacted metadata. Сам secret в incident artifacts не
  копировать.
- Не ослаблять guard и не подменять dedicated token общим
  `INTERNAL_API_TOKEN` ради восстановления доступности.
