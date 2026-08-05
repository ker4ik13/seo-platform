import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";

export function crawlMembershipScopeHash(
  config: TechnicalCrawlConfig
): string {
  return canonicalJsonSha256("technical-crawl-membership-scope@1", {
    startUrls: config.startUrls,
    ...(config.homepageChecks?.length
      ? { homepageChecks: config.homepageChecks }
      : {}),
    sitemapUrls: config.sitemapUrls,
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    queryPolicy: config.queryPolicy,
    maxUrls: config.maxUrls,
    maxDepth: config.maxDepth,
    obeyRobots: config.obeyRobots
  });
}
