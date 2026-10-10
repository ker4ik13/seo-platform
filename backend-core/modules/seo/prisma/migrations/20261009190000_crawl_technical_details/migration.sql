-- Additive, immutable snapshot evidence. Old snapshots remain explicitly unknown.
ALTER TABLE crawl_page_snapshots
  ADD COLUMN technical_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN link_details jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 0 is a no-request decision, never an HTTP response. Keep every previous bound.
ALTER TABLE crawl_page_snapshots DROP CONSTRAINT crawl_page_snapshots_bounds_check;
ALTER TABLE crawl_page_snapshots ADD CONSTRAINT crawl_page_snapshots_bounds_check CHECK (
  sequence > 0 AND depth >= 0 AND
  (status_code BETWEEN 100 AND 599 OR (status_code = 0 AND indexability = 'BLOCKED_ROBOTS')) AND
  response_time_ms >= 0 AND size_bytes >= 0 AND h1_count >= 0 AND image_count >= 0 AND
  images_missing_alt >= 0 AND images_missing_alt <= image_count AND word_count >= 0
);
