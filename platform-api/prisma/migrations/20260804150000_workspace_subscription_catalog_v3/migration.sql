BEGIN;

-- The subscription belongs to a workspace. Published versions are immutable:
-- close v2 and publish the product catalog requested for the public launch.
UPDATE "billing_plan_versions"
SET "effective_to" = '2026-08-04T00:01:00Z'
WHERE "version" = 2
  AND "effective_to" IS NULL
  AND "plan_id" IN (
    '019be4c0-0000-7000-8000-000000000001',
    '019be4c0-0000-7000-8000-000000000002',
    '019be4c0-0000-7000-8000-000000000003',
    '019be4c0-0000-7000-8000-000000000004',
    '019be4c0-0000-7000-8000-000000000005',
    '019be4c0-0000-7000-8000-000000000006'
  );

UPDATE "billing_plans"
SET
  "name_ru" = CASE "code"
    WHEN 'TRIAL' THEN 'Бесплатный'
    WHEN 'SOLO' THEN 'Старт'
    WHEN 'TEAM' THEN 'Профессиональный'
    WHEN 'AGENCY' THEN 'Максимальный'
    ELSE "name_ru"
  END,
  "description_ru" = CASE "code"
    WHEN 'TRIAL' THEN 'Для знакомства с платформой и одного проекта.'
    WHEN 'SOLO' THEN 'Для специалиста и небольшой команды до десяти человек.'
    WHEN 'TEAM' THEN 'Для SEO-команды с десятью проектами и параллельной работой.'
    WHEN 'AGENCY' THEN 'Для агентства: крупные проекты, высокий параллелизм и до 50 участников.'
    ELSE "description_ru"
  END,
  "status" = CASE WHEN "code" IN ('BUSINESS', 'ENTERPRISE')
    THEN 'RETIRED'::"BillingPlanStatus"
    ELSE 'ACTIVE'::"BillingPlanStatus"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN ('TRIAL', 'SOLO', 'TEAM', 'AGENCY', 'BUSINESS', 'ENTERPRISE');

INSERT INTO "billing_plan_versions" (
  "id", "plan_id", "version", "status", "effective_from", "features",
  "included_data_credits_minor", "trial_days", "service_description", "created_at"
)
VALUES
  (
    '019fce00-0000-7000-8000-000000001001',
    '019be4c0-0000-7000-8000-000000000001',
    3, 'PUBLISHED', '2026-08-04T00:01:00Z',
    '{"seats":3,"projects":1,"storedKeywords":1000,"keywordsPerProject":1000,"foldersPerProject":50,"concurrentJobs":1,"trackedContextPairs":1000,"storageBytes":536870912,"rawSerpRetentionDays":7,"scheduledAutomations":1,"guestReports":0,"byok":true,"publicApi":"SANDBOX","clientRole":false,"whiteLabel":false,"queuePriority":"TRIAL"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Бесплатный', CURRENT_TIMESTAMP
  ),
  (
    '019fce00-0000-7000-8000-000000001002',
    '019be4c0-0000-7000-8000-000000000002',
    3, 'PUBLISHED', '2026-08-04T00:01:00Z',
    '{"seats":10,"projects":3,"storedKeywords":15000,"keywordsPerProject":5000,"foldersPerProject":200,"concurrentJobs":5,"trackedContextPairs":15000,"storageBytes":5368709120,"rawSerpRetentionDays":30,"scheduledAutomations":25,"guestReports":10,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Старт, один месяц', CURRENT_TIMESTAMP
  ),
  (
    '019fce00-0000-7000-8000-000000001003',
    '019be4c0-0000-7000-8000-000000000003',
    3, 'PUBLISHED', '2026-08-04T00:01:00Z',
    '{"seats":20,"projects":10,"storedKeywords":100000,"keywordsPerProject":10000,"foldersPerProject":500,"concurrentJobs":10,"trackedContextPairs":100000,"storageBytes":32212254720,"rawSerpRetentionDays":90,"scheduledAutomations":250,"guestReports":100,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL_PLUS"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Профессиональный, один месяц', CURRENT_TIMESTAMP
  ),
  (
    '019fce00-0000-7000-8000-000000001004',
    '019be4c0-0000-7000-8000-000000000004',
    3, 'PUBLISHED', '2026-08-04T00:01:00Z',
    '{"seats":50,"projects":30,"storedKeywords":3000000,"keywordsPerProject":100000,"foldersPerProject":0,"concurrentJobs":30,"trackedContextPairs":3000000,"storageBytes":107374182400,"rawSerpRetentionDays":365,"scheduledAutomations":2000,"guestReports":1000,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":true,"queuePriority":"HIGH"}'::jsonb,
    0, 0, 'Доступ к SEOньорите, тариф Максимальный, один месяц', CURRENT_TIMESTAMP
  );

INSERT INTO "billing_plan_prices" (
  "id", "plan_version_id", "period", "currency", "amount_minor", "created_at"
)
VALUES
  ('019fce00-0000-7000-8000-000000002001', '019fce00-0000-7000-8000-000000001001', 'MONTHLY', 'RUB', 0, CURRENT_TIMESTAMP),
  ('019fce00-0000-7000-8000-000000002002', '019fce00-0000-7000-8000-000000001002', 'MONTHLY', 'RUB', 199000, CURRENT_TIMESTAMP),
  ('019fce00-0000-7000-8000-000000002003', '019fce00-0000-7000-8000-000000001003', 'MONTHLY', 'RUB', 599000, CURRENT_TIMESTAMP),
  ('019fce00-0000-7000-8000-000000002004', '019fce00-0000-7000-8000-000000001004', 'MONTHLY', 'RUB', 1499000, CURRENT_TIMESTAMP);

COMMIT;
