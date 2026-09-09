BEGIN;

ALTER TABLE "tracking_context_versions"
  DROP CONSTRAINT "tracking_context_versions_depth_allowed";

ALTER TABLE "tracking_context_versions"
  ADD CONSTRAINT "tracking_context_versions_depth_allowed"
  CHECK ("depth" IN (10, 20, 30, 50, 100));

COMMIT;
