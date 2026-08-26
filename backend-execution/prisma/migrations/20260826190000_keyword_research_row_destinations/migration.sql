ALTER TABLE "keyword_research_rows"
  ADD COLUMN "target_group_path" VARCHAR(2048);

ALTER TABLE "keyword_research_runs"
  ADD COLUMN "distribution_mode" VARCHAR(32) NOT NULL DEFAULT 'SINGLE_GROUP';
