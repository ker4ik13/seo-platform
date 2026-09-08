BEGIN;
ALTER TABLE billing_plans ADD COLUMN name_en VARCHAR(120), ADD COLUMN description_en TEXT;
-- Published prices/capacities are versioned. Existing subscriptions and
-- financial records remain on their original version until an explicit switch.
UPDATE billing_plan_versions SET effective_to = CURRENT_TIMESTAMP
WHERE effective_to IS NULL AND version < 5
  AND plan_id IN (SELECT id FROM billing_plans WHERE code IN ('TRIAL', 'SOLO', 'TEAM', 'AGENCY'));

UPDATE billing_plans SET
  name_ru = CASE code WHEN 'TRIAL' THEN 'Бесплатный' WHEN 'SOLO' THEN 'Старт' WHEN 'TEAM' THEN 'Про' WHEN 'AGENCY' THEN 'Агентство' END,
  name_en = CASE code WHEN 'TRIAL' THEN 'Free' WHEN 'SOLO' THEN 'Starter' WHEN 'TEAM' THEN 'Pro' WHEN 'AGENCY' THEN 'Agency' END,
  description_ru = CASE code WHEN 'TRIAL' THEN 'Попробуйте редактор и соберите первый проект без карты.' WHEN 'SOLO' THEN 'Для самостоятельной работы и небольшой команды.' WHEN 'TEAM' THEN 'Для регулярного SEO и больших семантических ядер.' WHEN 'AGENCY' THEN 'Для агентства, клиентских проектов и большой команды.' END,
  description_en = CASE code WHEN 'TRIAL' THEN 'Explore the editor and build your first project. No card required.' WHEN 'SOLO' THEN 'For independent specialists and small teams.' WHEN 'TEAM' THEN 'For ongoing SEO and large keyword sets.' WHEN 'AGENCY' THEN 'For agencies, client projects and larger teams.' END,
  updated_at = CURRENT_TIMESTAMP
WHERE code IN ('TRIAL', 'SOLO', 'TEAM', 'AGENCY');

INSERT INTO billing_plan_versions (id, plan_id, version, status, effective_from, features, included_data_credits_minor, trial_days, service_description, created_at)
SELECT uuidv7(), plan.id, 5, 'PUBLISHED', CURRENT_TIMESTAMP, catalog.features, 0, 0, catalog.description, CURRENT_TIMESTAMP
FROM billing_plans plan JOIN (VALUES
  ('TRIAL', '{"seats":2,"projects":2,"storedKeywords":10000,"keywordsPerProject":5000,"foldersPerProject":0,"concurrentJobs":1,"trackedContextPairs":10000,"storageBytes":536870912,"rawSerpRetentionDays":7,"scheduledAutomations":1,"guestReports":0,"byok":true,"publicApi":"SANDBOX","clientRole":false,"whiteLabel":false,"queuePriority":"TRIAL"}'::jsonb, 'Доступ к SEOньорите, тариф Бесплатный'),
  ('SOLO', '{"seats":5,"projects":5,"storedKeywords":150000,"keywordsPerProject":100000,"foldersPerProject":0,"concurrentJobs":3,"trackedContextPairs":300000,"storageBytes":2147483648,"rawSerpRetentionDays":30,"scheduledAutomations":20,"guestReports":10,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL"}'::jsonb, 'Доступ к SEOньорите, тариф Старт'),
  ('TEAM', '{"seats":15,"projects":20,"storedKeywords":1000000,"keywordsPerProject":300000,"foldersPerProject":0,"concurrentJobs":8,"trackedContextPairs":2000000,"storageBytes":10737418240,"rawSerpRetentionDays":90,"scheduledAutomations":100,"guestReports":100,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL_PLUS"}'::jsonb, 'Доступ к SEOньорите, тариф Про'),
  ('AGENCY', '{"seats":50,"projects":75,"storedKeywords":3000000,"keywordsPerProject":0,"foldersPerProject":0,"concurrentJobs":15,"trackedContextPairs":6000000,"storageBytes":32212254720,"rawSerpRetentionDays":365,"scheduledAutomations":500,"guestReports":500,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"HIGH"}'::jsonb, 'Доступ к SEOньорите, тариф Агентство')
) AS catalog(code, features, description) ON catalog.code = plan.code;

INSERT INTO billing_plan_prices (id, plan_version_id, period, currency, amount_minor, created_at)
SELECT uuidv7(), version.id, price.period::"BillingPeriod", 'RUB', price.amount_minor, CURRENT_TIMESTAMP
FROM billing_plans plan JOIN billing_plan_versions version ON version.plan_id = plan.id AND version.version = 5
JOIN (VALUES
  ('TRIAL', 'MONTHLY', 0::bigint),
  ('SOLO', 'MONTHLY', 99000::bigint), ('SOLO', 'ANNUAL', 990000::bigint),
  ('TEAM', 'MONTHLY', 249000::bigint), ('TEAM', 'ANNUAL', 2490000::bigint),
  ('AGENCY', 'MONTHLY', 599000::bigint), ('AGENCY', 'ANNUAL', 5990000::bigint)
) AS price(code, period, amount_minor) ON price.code = plan.code;
COMMIT;
