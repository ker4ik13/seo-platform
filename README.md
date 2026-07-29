# platform-jobs-integrations

Владелец асинхронных jobs, расписаний, provider connectors, импортов и внешних доставок.

## Entry points

- `src/main.ts` — internal HTTP API и readiness;
- `src/worker.main.ts` — system BullMQ worker;
- `src/inspection-worker.main.ts` — потоковая проверка uploads;
- `src/import-worker.main.ts` — парсинг, validation и publish семантики;
- `src/connector-worker.main.ts` — provider calls с минимальной
  `EXECUTION`-ролью credential vault.

Worker entrypoints разделяются по профилю нагрузки и набору секретов, а не по
каждой операции.

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

## Проверка BYOK credentials

HTTP-процесс запускается с `INTEGRATION_CREDENTIAL_ROLE=MANAGEMENT`: он
создаёт и ротирует envelope-encrypted secrets, поэтому получает KEK,
независимый fingerprint keyring и dedicated internal token.
`connector-worker` запускается с ролью `EXECUTION` и получает только KEK для
расшифровки. Конфигурация fail-closed отклоняет fingerprint keys и management
token у execution worker.

Arsenkin Tools и Keys.so проверяются асинхронно через документированные
read-only account/limits endpoints. PostgreSQL `Job` — источник истины,
BullMQ содержит только `jobId`; dispatcher восстанавливает потерянную очередь.
Job фиксирует `materialVersion`, поэтому результат старой проверки после
ротации не может активировать новый secret. XMLStock остаётся
`PENDING_VERIFICATION`, пока провайдер не предоставит подтверждённый
неоплачиваемый validation endpoint и test fixtures.
