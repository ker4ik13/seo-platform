-- The first bounded replay reached Realtime while its resource allowlist still
-- accepted crawl notifications only. Requeue the same idempotent terminal Job
-- events once after the corrected cross-service contract is deployed.
UPDATE "outbox_events"
SET
  "status" = 'PENDING',
  "attempts" = 0,
  "available_at" = CURRENT_TIMESTAMP,
  "published_at" = NULL
WHERE
  "status" = 'FAILED'
  AND "event_type" IN (
    'job.notification.completed.requested.v1',
    'job.notification.partially-completed.requested.v1',
    'job.notification.cancelled.requested.v1',
    'job.notification.failed.requested.v1',
    'job.notification.action-required.requested.v1'
  );
