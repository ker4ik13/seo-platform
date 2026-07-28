# platform-jobs-integrations

Владелец асинхронных jobs, расписаний, provider connectors, импортов и внешних доставок.

## Entry points

- `src/main.ts` — internal HTTP API и readiness;
- `src/worker.main.ts` — первый независимый BullMQ worker;
- последующие worker entrypoints добавляются по профилю нагрузки, а не по каждой операции.

## Адаптеры

- S3 multipart полностью конфигурируется через env и по умолчанию выключен;
- SMTP transactional email полностью конфигурируется через env и по умолчанию выключен;
- disabled adapters позволяют поднять foundation без внешних credentials;
- включённый, но недоступный обязательный adapter виден в readiness.

## Multipart uploads

Внутренний API `/internal/v1/uploads` создаёт opaque project-scoped object
keys, выдаёт короткоживущие signed URLs на отдельные parts, проверяет полный
набор ETag и фактический размер объекта при завершении. Все команды привязаны
к проверенным `workspaceId`, `projectId`, `actorId`; создание идемпотентно.

Статус `UPLOADED` ещё не разрешает импорт: следующий worker обязан потоково
вычислить SHA-256, проверить MIME по содержимому и malware scan, после чего
перевести объект в `READY` либо `REJECTED`.
