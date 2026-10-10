BEGIN;

-- Четыре вида дублей: максимум 2500 групп и 5000 участников каждого вида.
ALTER TABLE "crawl_duplicate_analyses"
  DROP CONSTRAINT "crawl_duplicate_analyses_counts_check",
  ADD CONSTRAINT "crawl_duplicate_analyses_counts_check"
    CHECK (
      "snapshot_count" BETWEEN 0 AND 5000 AND
      "group_count" BETWEEN 0 AND 10000 AND
      "issue_count" BETWEEN 0 AND 20000
    );

ALTER TABLE "crawl_duplicate_groups"
  DROP CONSTRAINT "crawl_duplicate_groups_member_count_check",
  ADD CONSTRAINT "crawl_duplicate_groups_member_count_check"
    CHECK ("member_count" BETWEEN 2 AND 5000);

ALTER TABLE "crawl_membership_analyses"
  DROP CONSTRAINT "crawl_membership_analyses_counts_check",
  ADD CONSTRAINT "crawl_membership_analyses_counts_check"
    CHECK (
      "snapshot_count" BETWEEN 0 AND 5000 AND
      "missing_count" BETWEEN 0 AND 5000 AND
      (
        "status" = 'COMPLETED'
        OR ("previous_crawl_id" IS NULL AND "missing_count" = 0)
      ) AND
      ("missing_count" = 0 OR "previous_crawl_id" IS NOT NULL)
    );

COMMIT;
