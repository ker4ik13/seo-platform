-- MANUAL_RANK_CHECK scope_snapshot is immutable. New Jobs persist the public
-- presentation fields at creation time; legacy summaries read the same two
-- allowlisted values from the already immutable manifest command. No data
-- rewrite is required or permitted here.
SELECT 1;
