ALTER TABLE "rank_snapshots"
  ADD COLUMN "position_tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "ai_answer_snapshots"
  ADD COLUMN "position_tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "rank_snapshots"."position_tracking_enabled" IS
  'Whether this immutable SERP snapshot may affect current and historical project positions.';

COMMENT ON COLUMN "ai_answer_snapshots"."position_tracking_enabled" IS
  'Whether this immutable AI SERP snapshot may affect current and historical project AI positions.';
