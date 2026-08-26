# ADR-2026-045: Redacted projection для live-диагностики позиций

- Статус: принято
- Дата: 26 августа 2026 года
- Затронутые области: Execution, PostgreSQL ACL, Contracts, Frontend
- Изменение API/БД: tenant-scoped runtime diagnostics endpoint и owner-owned
  функция `read_rank_runtime_diagnostics_entries`

## Контекст

Пользователь должен видеть ход XMLStock-съёма по ключам, попыткам и страницам
в реальном времени. Точный текст ключа хранится в immutable provider request
intent, но эта таблица намеренно полностью закрыта от general `jobs_runtime`:
она также содержит private adapter snapshot, который нельзя делать обычным
HTTP-read model.

Прямой `SELECT` из HTTP-сервиса нарушает capability boundary ADR-2026-034.
Передача raw snapshot или физического lease owner в браузер также раскрыла бы
внутреннее устройство исполнения.

## Решение

- Прямые table privileges general `jobs_runtime` не расширяются.
- Owner-owned `SECURITY DEFINER` функция принимает exact workspace/project/job
  и возвращает не более 250 последних execution rows.
- Allowlist содержит только sequence, текст ключа, нормализуемый status,
  счётчики submit/poll, bounded page progress, allowlisted error code,
  timestamps и уже вычисленный active boolean.
- Credential, provider request ID, raw payload и физический lease owner не
  возвращаются даже внутреннему HTTP caller.
- `PUBLIC EXECUTE` отозван; exact `EXECUTE` получает только `jobs_runtime`.
  Canonical HTTP guard и composite tenant predicates остаются обязательными.

## Миграция и совместимость

Миграция создаёт только read projection и ACL, без изменения существующих
таблиц или rows. Permission reconciler повторяет exact grant после deploy.
Существующие Jobs и connector workers совместимы без перезаписи данных.

## Последствия и rollback

Live-монитор получает нужный пользователю текст без доступа к private table и
без утечки worker/provider identity. Цена решения — одна reviewed owner-owned
функция. Rollback состоит в отключении endpoint, отзыве `EXECUTE` и удалении
функции отдельной миграцией; данные операций не меняются.
