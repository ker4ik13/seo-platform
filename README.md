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
ротации не может активировать новый secret. Успешная внешняя проверка
обновляет сохранённый capability snapshot текущим provider allowlist; новую
capability старый ключ получает только после revalidation. XMLStock остаётся
`PENDING_VERIFICATION`, пока провайдер не предоставит подтверждённый
неоплачиваемый validation endpoint и test fixtures.

## Проектные привязки connectors

Внутренний project-scoped API
`/internal/v1/workspaces/:workspaceId/projects/:projectId/integration-settings`
возвращает нормализованный aggregate, создаёт одну привязку на
`workspace + project + capability` и изменяет её по
`.../integration-settings/:bindingId`. Route, trusted headers и command body
должны содержать один и тот же workspace/project/actor context; используется
тот же отдельный credential API token, что и для vault.

Первый срез поддерживает только один route с `position=0`,
`sourceKind=WORKSPACE_CREDENTIAL` и активным `BYOK_API_KEY`. Credential обязан
принадлежать workspace, не быть удалённым и предоставлять capability,
сохранённую одновременно в credential и текущем provider catalog. Platform
credentials, fallback и binding budgets возвращают
`FEATURE_NOT_AVAILABLE`; их нельзя имитировать пустыми обещаниями.

Создание хранит immutable receipt с 32-byte request hash и исходным response
snapshot. Точный повтор после PATCH возвращает первоначальный create response,
другой payload с тем же ключом — `IDEMPOTENCY_CONFLICT`. PATCH использует CAS;
stale version возвращает HTTP 412 `VERSION_CONFLICT` с безопасным
`currentVersion`. Привязки не удаляются: отключение — `enabled=false`, причём
сломанное credential не мешает отключить текущий route.

Binding, route, create receipt и redacted outbox event записываются одной
транзакцией. Outbox payload не содержит credential ID, label, display hint,
provider metadata или secret fields, использует общий contract и содержит
только allowlisted `changedFields`. GET сохраняет недоступные bindings с
явным availability, а credential options содержит только безопасную проекцию
неудалённых workspace credentials. Aggregate ограничен 500 options,
выставляет `credentialOptionsTruncated` и всегда сохраняет в bounded выдаче
credentials текущих bindings. Capabilities всегда являются пересечением
сохранённого JSON и текущего provider catalog; malformed JSON fail-closed
даёт пустой набор. Aggregate читает bindings и credential options из одного
`REPEATABLE READ` snapshot. Создание, включение и смена route удерживают
tenant-scoped `FOR SHARE` lock на credential до commit, но отключение
неизменённого inactive route не требует доступного credential. Ни один из
этих запросов не выбирает vault material.

Migration нормализует старую pre-release `integration_bindings` только при
пустой таблице. При наличии строк deploy останавливается: для такого
окружения нужен отдельный expand → backfill → validate → contract план,
удалять данные ради прохождения migration запрещено. Перед проверкой пустоты
legacy-таблица блокируется в `ACCESS EXCLUSIVE`, поэтому конкурентная запись
не может попасть между precondition и `DROP TABLE`.
