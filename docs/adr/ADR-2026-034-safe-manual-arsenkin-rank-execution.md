# ADR-2026-034: безопасный manual rank execution через Arsenkin

Статус: принято; live submit заблокирован внешним contract gate
Дата: 29 июля 2026 года

## Контекст

Project connector binding и versioned tracking contexts позволяют выбрать
валидный BYOK route и точную поисковую конфигурацию, но сами по себе не делают
внешний rank check безопасным.

Публичная документация Arsenkin описывает общий async lifecycle
`set → check → get`, лимиты и пример запроса `positions`, но не публикует:

- полную JSON-схему результата `positions`;
- исчерпывающий vocabulary состояний `check`;
- provider idempotency key или client reference для `set`;
- способ найти завершённую задачу при потере ответа `set`;
- представление language, country и safe search;
- однозначную семантику Яндекса: текст и пример документации расходятся по
  `type`.

Автоматический повтор неоднозначного `set` может повторно списать лимиты
пользователя. Локальный request hash не превращает внешний вызов в
идемпотентный.

## Решение

Первый rank execution реализуется в существующих сервисах без нового
микросервиса:

- `platform-api` проверяет session, `ranking.run`, lifecycle, entitlement и
  выдаёт короткоживущий execution grant;
- `platform-seo-data` владеет immutable manifest, pair scope, append-only
  snapshots и current projection;
- `platform-jobs-integrations` владеет estimate, Job/JobItem, provider
  lifecycle, fairness и execution state;
- `platform-realtime` впоследствии доставляет redacted terminal events по
  effective notification policy.

В `platform-jobs-integrations` используются два процесса одного образа:

- `rank-worker` без KEK планирует работу, применяет fairness и сохраняет
  нормализованный результат;
- `connector-worker` с execution KEK выполняет только allowlisted provider
  calls и строгую нормализацию.

Это process boundary, а не новый repository или database.

## Первый функциональный scope

- manual BYOK;
- Arsenkin `positions`;
- только assigned keywords выбранного tracking context;
- один context на provider task;
- `format=0`;
- `rawSerp=false`;
- fallback `NONE`;
- platform provider charge равен нулю, допускается только тарифная SaaS quota;
- начальный chunk — не более 250 keywords, hard cap команды — 1 000 до
  benchmark;
- Google Desktop/Mobile TOP-30;
- Яндекс и дополнительные depths включаются только после recorded contract;
- любая непредставимая часть tracking configuration блокирует estimate:
  worker не имеет права молча игнорировать country, language, safe search или
  domain matching.

Boolean `safeSearch` текущего contract не заменяется молча provider default.
Если provider не позволяет представить оба значения, compatibility остаётся
blocked. Возможный tri-state требует совместимой новой версии contract и ADR.

## Public command flow

### Estimate

`POST /api/v1/projects/{projectId}/rank-estimates`

Estimate не вызывает provider и может быть рассчитан в read-only режиме. Он
возвращает:

- keyword/context/pair count;
- scope hash и configuration versions;
- provider task count;
- ожидаемое число provider requests и limits;
- `platformChargeMicro = "0"` для BYOK;
- тарифную quota;
- credential freshness;
- compatibility blockers;
- retention/result summary;
- `expiresAt`, первоначально пять минут;
- `executionAllowed`.

Стоимость provider limits хранится как versioned catalog observation с
источником и временем, а не как вечная константа. Денежная стоимость
пользовательского тарифа Arsenkin не вычисляется платформой.

Первый реализованный gate-zero slice хранит estimate как отдельный immutable
resource в `jobs_db`, а не как Job. Он требует `ranking.view`, CSRF и
`Idempotency-Key`, поэтому остаётся доступен в read-only и показывает
lifecycle/RBAC как blockers. Jobs сам запрашивает атомарный semantic scope у
SEO Data, затем читает allowlisted binding/credential validation metadata
без decrypt. TTL — пять минут; exact replay его не продлевает.

Пока отсутствуют recorded provider contract, authoritative entitlement/quota
и versioned provider limit observation, соответствующие поля честно имеют
`NOT_AVAILABLE`, а blockers
`PROVIDER_CONTRACT_NOT_READY` и `PROVIDER_EXECUTION_DISABLED` обязательны.
Gate-zero slice не создаёт Job/JobItem, BullMQ message, usage/reservation,
outbox event и не вызывает provider.

### Run

`POST /api/v1/projects/{projectId}/rank-runs`

Команда требует CSRF, `ranking.run`, `Idempotency-Key`, актуальный `estimateId`,
ACTIVE workspace/project, READY binding, ACTIVE BYOK credential, entitlement,
quota и открытый provider/capability kill switch. Ответ — `202` и `Location`
на tenant-safe project-scoped
`/api/v1/projects/{projectId}/jobs/{jobId}`. Глобальный Job URL не
используется, пока Platform API не владеет безопасной locator projection.

Точный повтор возвращает существующий Job. Другой command под тем же ключом
возвращает `IDEMPOTENCY_CONFLICT`. Active deduplication по
`project + semantic deduplication hash + provider` предотвращает второй
submit через новый пользовательский ключ.

Первый contract-only инкремент уже фиксирует public create body только с
`estimateId`, конечную discriminated lifecycle-матрицу Job и отдельный
`ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`. Он не включает runtime endpoint,
Job/JobItem или provider call.

Чтение Job требует `ranking.view`. Cooperative cancel использует
`collector.cancel`, разрешён в billing read-only и для архивного проекта и
идемпотентен: `CANCEL_REQUESTED/CANCELLED` replay не меняет состояние, другой
terminal status также не переписывается. `actorId` команды — audit actor, а
не owner predicate: участник команды с project permission может читать и
отменять Job другого участника.

## Immutable manifest

До provider call SEO Data запечатывает manifest:

- Job, workspace и project;
- project domain/version snapshot;
- keyword ID/text/version;
- context ID/configuration version/hash;
- provider-compatible execution parameters;
- pair count/hash;
- retention и status.

Jobs хранит manifest reference/hash и execution snapshot: binding/version,
credential material version, connector version, mode и format. Public DTO
не раскрывает credential/binding internals.

Contract разделяет full integrity `manifestHash` и semantic
`deduplicationHash`. Semantic preimage содержит только tenant/project,
фактический domain, provider-effective execution, retention и упорядоченные
`keywordId + textHash + language`. Он не содержит tracking context identity,
run/assignment IDs, logical revisions, configuration/scope evidence hashes,
actor и время. Поэтому clone/rename эквивалентного context, display-only
`regionLabel`, изменение метаданных ключа, remove/reassign и новый
idempotency key не обходят project-wide active dedup, если внешняя работа та
же. Run-specific audit/evidence-поля входят в full `manifestHash`.
Audit `sealedBy` входит в full seal/preimage. Storage-local `requestHash`
используется только для timing-safe проверки exact command replay и явно не
является частью contract manifest integrity.

Manifest/chunk hashes строятся только общими exact allowlist-builder’ами
`platform-contracts` и RFC 8785 JCS с versioned domain separator. Hash текста
ключа — SHA-256 точных UTF-8 bytes без normalization/JSON/newline. Golden
vectors обязательны для producer и verifier. Ingest hash покрывает полную
provenance команды. Finalize и ingest сериализуются одним manifest lock,
после terminal finalize late ingest запрещён.

Реализованный SEO Data boundary хранит три таблицы:

- `rank_execution_manifests`;
- `rank_execution_manifest_chunks`;
- `rank_execution_manifest_entries`.

Manifest создаётся как `BUILDING` только внутри одной `RepeatableRead`
транзакции, наполняется chunks/entries и переводится в `SEALED`. Deferred
constraint trigger запрещает committed `BUILDING`; прямой insert
`SEALED/CLOSED`, изменение/удаление header или children, late child insert и
`TRUNCATE` запрещены. Единственный последующий переход —
`SEALED → CLOSED`; закрытие освобождает partial unique active-dedup key, но
не удаляет manifest. При seal DB повторно проверяет принадлежность assignment
контексту/ключу и точное состояние keyword snapshot.

Перед materialization SEO Data выполняет bounded byte-first preflight:
максимум 1 000 ключей, 500 Unicode code points и 2 000 UTF-8 bytes на ключ,
2 000 000 bytes на весь scope; chunk size — 250. Лимит 500 символов принят
консервативно из опубликованного Projects API Arsenkin, поскольку отдельный
лимит `positions` не опубликован. Provider-incompatible bounded scope
возвращает unavailable hash и не загружает большие тексты в Node.

Secret-bearing endpoints seal/chunk используют отдельный
`JOBS_TO_SEO_RANK_TOKEN` и header `x-rank-execution-token`; общий
`INTERNAL_API_TOKEN` их не открывает. Пока Jobs PREPARING runtime не
реализован, этот token получает только SEO Data для валидации. При добавлении
caller secret передаётся только конкретному Jobs HTTP/rank process, не
generic/import/connector workers и не queue payload.

Создание — идемпотентная saga:

1. Jobs создаёт `PREPARING_SCOPE`.
2. SEO Data seal-ит manifest по Job ID.
3. Drift завершает Job как `ESTIMATE_STALE` до provider call.
4. Rank worker создаёт items и переводит Job в `QUEUED`.

## Authoritative execution grant

Перед каждым новым `set` rank worker синхронно получает одноразовый grant с
TTL около 30 секунд. Claim server-side повторно проверяет:

- ACTIVE workspace/project;
- entitlement и quota;
- Job/cancel state;
- binding ID/version/route;
- credential ID/material version/status/capability;
- connector version;
- provider/capability kill switch.

Read-only или архивирование запрещают новые `set`, но уже принятый provider
request разрешено `check/get` и сохранить. Security suspension, revoke или
rotation запрещают дальнейшее использование старого secret.

## Execution isolation

Текущий connector login с global `SELECT` jobs и credential vault является
release blocker. До live submit вводятся scoped `connector_executions`,
staging rows и SECURITY DEFINER operations:

- claim execution;
- authorize provider action;
- record submit;
- schedule poll;
- stage normalized rows;
- finish/fail execution.

Connector role получает `EXECUTE`, но не прямой `SELECT/INSERT/UPDATE` доменных
таблиц. Claim проверяет tenant/job/item scope, lease и grant. Обязательны
отдельный Redis ACL/namespace, KEK decrypt canary, circuit breaker и
совместимый rollout connector versions.

## Provider lifecycle и retry

Внутренние states включают:

- `READY_TO_SUBMIT`;
- `SUBMITTING`;
- `SUBMIT_OUTCOME_UNKNOWN`;
- `SUBMITTED`;
- `POLL_WAIT`;
- `RESULT_READY`;
- `FETCHING`;
- `NORMALIZED`;
- `STAGED`;
- `PERSISTED`;
- retryable/final failure и cancellation.

После начала `set` transport timeout, потеря response, crash или неоднозначный
`5xx` переводят item в `SUBMIT_OUTCOME_UNKNOWN`. Автоматически повторять
`set` запрещено. UI предлагает только осознанный новый запуск с предупреждением
о возможном повторном списании provider limits.

Явный `429`, локальная ошибка до отправки bytes и внутреннее persistence можно
повторять безопасно. Repeatability `check/get` подтверждается recorded
contract до включения.

Provider quota bucket общий для validation и всех execution calls. Лимиты
задаются конфигурацией с запасом и не повышаются выше официально
подтверждённых. Fair dispatcher отдаёт приоритет recovery уже оплаченного
результата, затем poll/cancel/validation и только после этого новым submits.

## Partial result и persistence

JobItem соответствует одному context и одному keyword chunk. Успешные chunks
сохраняются независимо. `not found` — валидный snapshot, а отсутствующая или
дублирующая provider row — parse error.

SEO Data принимает chunks по идемпотентным receipts:

1. проверяет payload hash и manifest membership;
2. возвращает прежний receipt при exact replay;
3. конфликтует при другом payload того же chunk;
4. пишет append-only snapshots;
5. обновляет current только более новым observation;
6. фиксирует receipt в той же транзакции.

Out-of-order delivery не откатывает current. Partial success даёт
`PARTIALLY_COMPLETED`; unknown submit не входит в automatic failed-subset
retry.

Terminal transaction пишет redacted `job.*` outbox, а SEO Data —
`seo.rank-check.completed.v1`. Payload не содержит keyword text, URL,
credential ID и raw provider response.

## Live release gate

Live `set` остаётся выключенным, пока не выполнены все условия:

1. controlled one-key fixture или письменное подтверждение methods, statuses,
   positions response schema, repeatability и Yandex semantics;
2. подтверждение допустимости SaaS-обработки пользовательского BYOK token;
3. scoped connector execution вместо global vault read;
4. KEK canary и circuit breaker;
5. authoritative lifecycle/billing grant;
6. immutable manifest и ingest receipts;
7. per-credential/workspace/provider fairness и rate limiting;
8. `SUBMIT_OUTCOME_UNKNOWN` без auto-resubmit;
9. kill switch и повторная credential validation;
10. PostgreSQL 18 migration/load smoke.

## Официальные источники

- Arsenkin API: <https://help.arsenkin.ru/api>
- Positions API: <https://help.arsenkin.ru/api/single-positions>
- Оферта Arsenkin: <https://arsenkin.ru/Dogovor-oferta.pdf>
