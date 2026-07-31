ALTER TABLE "crawl_page_snapshots"
  ADD COLUMN "in_sitemap" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "crawl_page_snapshots"
  ALTER COLUMN "in_sitemap" DROP DEFAULT;

ALTER TABLE "crawl_page_changes"
  DROP CONSTRAINT "crawl_page_changes_diff_check";

ALTER TABLE "crawl_page_changes"
  ADD CONSTRAINT "crawl_page_changes_diff_check" CHECK (
    jsonb_typeof("diff") = 'object' AND
    jsonb_typeof("diff"->'fields') = 'array' AND
    cardinality("changed_fields") BETWEEN 1 AND 24 AND
    "changed_fields" <@ ARRAY[
      'statusCode', 'redirectChain', 'inSitemap', 'title', 'description',
      'h1', 'h1Count', 'headings', 'canonicalUrl', 'robots', 'language',
      'hreflang', 'internalLinks', 'externalLinks', 'imageCount',
      'imagesMissingAlt', 'structuredDataTypes', 'wordCount',
      'contentHash', 'indexability', 'responseTimeMs', 'sizeBytes'
    ]::VARCHAR(64)[]
  );
