-- The HTTP runtime previously did not receive PLATFORM_API_URL, so terminal
-- notification delivery could exhaust its retries against localhost. Replay
-- only those bounded, idempotent notification events once after the route fix.
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
