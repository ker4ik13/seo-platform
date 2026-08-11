BEGIN;

-- Published catalog rows stay immutable. Version 4 removes product folder
-- caps, raises workspace capacities and keeps every financial/history row.
UPDATE "billing_plan_versions"
SET "effective_to" = '2026-08-11T22:30:00Z'
WHERE "version" = 3
  AND "effective_to" IS NULL
  AND "plan_id" IN (
    '019be4c0-0000-7000-8000-000000000001',
    '019be4c0-0000-7000-8000-000000000002',
    '019be4c0-0000-7000-8000-000000000003',
    '019be4c0-0000-7000-8000-000000000004'
  );

UPDATE "billing_plans"
SET
  "description_ru" = CASE "code"
    WHEN 'TRIAL' THEN 'Для знакомства: до пяти участников и двух проектов.'
    WHEN 'SOLO' THEN 'Для команды до двадцати участников и десяти проектов.'
    WHEN 'TEAM' THEN 'Для SEO-команды до пятидесяти участников и тридцати проектов.'
    WHEN 'AGENCY' THEN 'Для агентства: до ста участников, ста проектов и ключи без лимита.'
    ELSE "description_ru"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN ('TRIAL', 'SOLO', 'TEAM', 'AGENCY');

INSERT INTO "billing_plan_versions" (
  "id", "plan_id", "version", "status", "effective_from", "features",
  "included_data_credits_minor", "trial_days", "service_description", "created_at"
)
VALUES
  (
    '019fe000-0000-7000-8000-000000001001',
    '019be4c0-0000-7000-8000-000000000001',
    4, 'PUBLISHED', '2026-08-11T22:30:00Z',
    '{"seats":5,"projects":2,"storedKeywords":10000,"keywordsPerProject":5000,"foldersPerProject":0,"concurrentJobs":1,"trackedContextPairs":10000,"storageBytes":536870912,"rawSerpRetentionDays":7,"scheduledAutomations":1,"guestReports":0,"byok":true,"publicApi":"SANDBOX","clientRole":false,"whiteLabel":false,"queuePriority":"TRIAL"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Бесплатный', CURRENT_TIMESTAMP
  ),
  (
    '019fe000-0000-7000-8000-000000001002',
    '019be4c0-0000-7000-8000-000000000002',
    4, 'PUBLISHED', '2026-08-11T22:30:00Z',
    '{"seats":20,"projects":10,"storedKeywords":200000,"keywordsPerProject":20000,"foldersPerProject":0,"concurrentJobs":5,"trackedContextPairs":200000,"storageBytes":5368709120,"rawSerpRetentionDays":30,"scheduledAutomations":25,"guestReports":10,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Старт, один месяц', CURRENT_TIMESTAMP
  ),
  (
    '019fe000-0000-7000-8000-000000001003',
    '019be4c0-0000-7000-8000-000000000003',
    4, 'PUBLISHED', '2026-08-11T22:30:00Z',
    '{"seats":50,"projects":30,"storedKeywords":1500000,"keywordsPerProject":50000,"foldersPerProject":0,"concurrentJobs":15,"trackedContextPairs":1500000,"storageBytes":32212254720,"rawSerpRetentionDays":90,"scheduledAutomations":250,"guestReports":100,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL_PLUS"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Профессиональный, один месяц', CURRENT_TIMESTAMP
  ),
  (
    '019fe000-0000-7000-8000-000000001004',
    '019be4c0-0000-7000-8000-000000000004',
    4, 'PUBLISHED', '2026-08-11T22:30:00Z',
    '{"seats":100,"projects":100,"storedKeywords":0,"keywordsPerProject":0,"foldersPerProject":0,"concurrentJobs":30,"trackedContextPairs":0,"storageBytes":107374182400,"rawSerpRetentionDays":365,"scheduledAutomations":2000,"guestReports":1000,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":true,"queuePriority":"HIGH"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Максимальный, один месяц', CURRENT_TIMESTAMP
  );

INSERT INTO "billing_plan_prices" (
  "id", "plan_version_id", "period", "currency", "amount_minor", "created_at"
)
VALUES
  ('019fe000-0000-7000-8000-000000002001', '019fe000-0000-7000-8000-000000001001', 'MONTHLY', 'RUB', 0, CURRENT_TIMESTAMP),
  ('019fe000-0000-7000-8000-000000002002', '019fe000-0000-7000-8000-000000001002', 'MONTHLY', 'RUB', 199000, CURRENT_TIMESTAMP),
  ('019fe000-0000-7000-8000-000000002003', '019fe000-0000-7000-8000-000000001003', 'MONTHLY', 'RUB', 599000, CURRENT_TIMESTAMP),
  ('019fe000-0000-7000-8000-000000002004', '019fe000-0000-7000-8000-000000001004', 'MONTHLY', 'RUB', 1499000, CURRENT_TIMESTAMP);

-- Existing non-cancelled workspaces receive the new capacity immediately.
-- Their periods, payment references, balances and ledger remain untouched.
UPDATE "billing_subscriptions" AS subscription
SET
  "plan_version_id" = CASE current_version."plan_id"
    WHEN '019be4c0-0000-7000-8000-000000000001'::uuid THEN '019fe000-0000-7000-8000-000000001001'::uuid
    WHEN '019be4c0-0000-7000-8000-000000000002'::uuid THEN '019fe000-0000-7000-8000-000000001002'::uuid
    WHEN '019be4c0-0000-7000-8000-000000000003'::uuid THEN '019fe000-0000-7000-8000-000000001003'::uuid
    WHEN '019be4c0-0000-7000-8000-000000000004'::uuid THEN '019fe000-0000-7000-8000-000000001004'::uuid
  END,
  "version" = subscription."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "billing_plan_versions" AS current_version
WHERE current_version."id" = subscription."plan_version_id"
  AND current_version."plan_id" IN (
    '019be4c0-0000-7000-8000-000000000001',
    '019be4c0-0000-7000-8000-000000000002',
    '019be4c0-0000-7000-8000-000000000003',
    '019be4c0-0000-7000-8000-000000000004'
  )
  AND subscription."status"::text <> 'CANCELLED';

COMMIT;
