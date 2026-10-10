ALTER TABLE technical_crawls ADD COLUMN blocked_urls integer NOT NULL DEFAULT 0;
ALTER TABLE technical_crawls ADD CONSTRAINT technical_crawls_blocked_urls_check CHECK (blocked_urls >= 0 AND blocked_urls <= processed_urls);
ALTER TABLE technical_crawls DROP CONSTRAINT technical_crawls_counts_check;
ALTER TABLE technical_crawls ADD CONSTRAINT technical_crawls_counts_check CHECK (
  discovered_urls >= 0 AND processed_urls >= 0 AND successful_urls >= 0 AND failed_urls >= 0 AND
  issue_count >= 0 AND blocked_urls >= 0 AND processed_urls = successful_urls + failed_urls + blocked_urls
);
