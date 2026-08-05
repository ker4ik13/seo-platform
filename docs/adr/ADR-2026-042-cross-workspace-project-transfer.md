# ADR-2026-042: безопасная передача проекта между рабочими областями

- Статус: принято
- Дата: 5 августа 2026 года
- Затронутые области: Core tenants/RBAC, Core SEO, Execution, integrations,
  billing capacity, notifications
- Изменение API/БД: принятие передачи требует целевой workspace; Core хранит
  возобновляемое состояние переноса; SEO меняет tenant scope; Execution
  отзывает project routes и останавливает automations

## Контекст

Прежний contract менял только `projects.owner_user_id` внутри исходной
рабочей области. Он не решал перенос проекта в tenant получателя и сохранял
доступ проекта к BYOK-маршрутам исходной команды. Простое изменение
`projects.workspace_id` небезопасно: проектные данные находятся в отдельных
Core SEO и Execution databases, а cross-database transaction отсутствует.

Provider credentials всегда принадлежат workspace. История provider jobs и
расчётов является также billing/audit history исходной рабочей области и не
должна раскрываться новому tenant.

## Решение

Адресат при принятии явно выбирает одну из своих активных рабочих областей,
в которой имеет `project.create`; исходную workspace выбрать нельзя. Core
проверяет project capacity и переводит запрос в durable `PROCESSING`, а
проект временно архивирует, закрывая новые mutation и provider submit.

Перенос является идемпотентной возобновляемой saga с фиксированным порядком:

1. Execution подтверждает отсутствие активных project Jobs, отключает
   automations, выключает старые project bindings и retire-ит все активные
   project routes. Отключённый binding сохраняется для audit и последующей
   явной настройки, но проецируется без primary route (`routes: []`).
   Credential rows и workspace defaults не перемещаются; прежний route не
   восстанавливается автоматически даже при возвратной передаче проекта.
2. Core SEO одной PostgreSQL transaction меняет `workspace_id` всех
   явно перечисленных project-owned domain rows. Все затронутые tenant foreign
   keys проверяются отложенно при commit; функция отклоняет строки из третьего
   tenant. Immutable rank/crawl rows допускают только точную замену tenant key
   внутри `SECURITY DEFINER` routine: остальные поля должны побайтно остаться
   прежними. Для rank manifest отдельно сохраняется `integrity_workspace_id`,
   с которым он был запечатан, поэтому проверка исходного hash остаётся
   валидной после смены operational `workspace_id`.
3. Core одной transaction меняет `projects.workspace_id` и владельца,
   удаляет доступы участников исходной workspace, выдаёт новому владельцу
   `MANAGER`, возвращает прежний lifecycle status и публикует audit/outbox.

Короткий reconciler в Core повторяет только идемпотентные этапы с bounded
backoff. Конкурентные replicas claim-ят попытку через conditional update.
`PENDING` можно отменить или отклонить; после `PROCESSING` откат пользователем
запрещён, чтобы не вернуть Core поверх уже перенесённых SEO rows.

Execution history, provider usage, uploads/import staging и billing receipts
остаются в исходной workspace и после завершения недоступны получателю.
Нормализованные семантика, страницы, tracking contexts и rank history
переходят вместе с проектом. Новые операции создаются только в целевой
workspace и используют только её workspace defaults либо заново настроенный
project binding.

## Безопасность и отказоустойчивость

- Никакой credential ID, route ID или secret не переносится и не включается
  в transfer payload.
- До шага Execution перенос не продолжается при активной операции.
- SEO re-scope выполняется параметризованной allowlisted database routine;
  `PUBLIC EXECUTE` отозван, runtime grant задан явно; добавление новой
  project-owned таблицы требует явного migration review allowlist.
- Trigger-предикат `project_workspace_rekey_allowed` имеет прямой `EXECUTE`
  только у `seo_runtime`, потому что PostgreSQL вычисляет trigger `WHEN` от
  имени вызывающей роли. Предикат остаётся `SECURITY INVOKER` и проверяет
  owner-context transfer routine, поэтому обычный runtime-вызов всегда
  возвращает `false` и не обходит immutable guards.
- Каждый следующий шаг безопасно повторяет предыдущий. Core меняется
  последним, поэтому новый tenant не получает проект до отзыва старых routes
  и успешного SEO commit.
- Ошибка dependency оставляет transfer в `PROCESSING` с нормализованным кодом
  и временем следующей попытки; raw upstream response не сохраняется.

## Последствия

Плюсы: tenant и provider boundary соответствуют ожиданию пользователя;
частичный сбой восстанавливается без ручного SQL; история платных вызовов не
утекает новому владельцу.

Компромиссы: во время переноса проект read-only; история операций Execution
не переезжает; большой SEO-проект удерживает одну bounded database
transaction и должен контролироваться statement/lock timeout и метриками.

## Rollback

До `PROCESSING` запрос отменяется штатно. После начала saga автоматический
reverse-transfer не выполняется: безопасный rollback — завершить forward
reconcile. Возврат проекта назад оформляется новой передачей после terminal
`ACCEPTED`, что снова отзывает уже новые project routes.
