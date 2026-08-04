CREATE UNIQUE INDEX "outbox_events_terminal_job_notification_key"
ON "outbox_events" ("event_type", "aggregate_id")
WHERE "event_type" IN (
  'job.notification.completed.requested.v1',
  'job.notification.partially-completed.requested.v1',
  'job.notification.cancelled.requested.v1',
  'job.notification.failed.requested.v1',
  'job.notification.action-required.requested.v1'
);
