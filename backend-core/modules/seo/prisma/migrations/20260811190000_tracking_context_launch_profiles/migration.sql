ALTER TABLE "tracking_contexts"
ADD COLUMN "launch_profile" JSONB;

COMMENT ON COLUMN "tracking_contexts"."launch_profile" IS
  'Editable rank launch defaults. Exact keyword assignments remain authoritative for immutable runs.';
