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
