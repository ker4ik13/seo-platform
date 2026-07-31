import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import {
  crawlScopeAllows,
  normalizedScopeUrl
} from "./crawl-scope.js";

export interface CrawlPendingUrl {
  readonly url: string;
  readonly depth: number;
  readonly inSitemap: boolean;
}

export interface CrawlCheckpoint {
  readonly version: 2;
  readonly pending: readonly CrawlPendingUrl[];
  readonly seen: readonly string[];
  readonly sitemapPending: readonly string[];
  readonly sitemapSeen: readonly string[];
  readonly scopeReady: boolean;
}

export function initialCrawlCheckpoint(
  config: TechnicalCrawlConfig
): CrawlCheckpoint {
  const startUrls = config.startUrls
    .map((url) => normalizedScopeUrl(url, config.queryPolicy));
  return {
    version: 2,
    pending: startUrls.map((url) => ({
      url,
      depth: 0,
      inSitemap: false
    })),
    seen: startUrls,
    sitemapPending: [...config.sitemapUrls],
    sitemapSeen: [...config.sitemapUrls],
    scopeReady: config.sitemapUrls.length === 0
  };
}

export function storedCrawlCheckpoint(
  value: unknown,
  config: TechnicalCrawlConfig
): CrawlCheckpoint {
  if (value === null) return initialCrawlCheckpoint(config);
  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (input.version === 1) {
    if (
      Object.keys(input).length !== 3 ||
      Object.keys(input).some(
        (key) => !["version", "pending", "seen"].includes(key)
      )
    ) {
      invalid();
    }
    return storedLegacyCheckpoint(input, config);
  }
  if (
    Object.keys(input).length !== 6 ||
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "pending",
          "seen",
          "sitemapPending",
          "sitemapSeen",
          "scopeReady"
        ].includes(key)
    ) ||
    input.version !== 2 ||
    !Array.isArray(input.pending) ||
    !Array.isArray(input.seen) ||
    !Array.isArray(input.sitemapPending) ||
    !Array.isArray(input.sitemapSeen) ||
    typeof input.scopeReady !== "boolean" ||
    input.pending.length > config.maxUrls ||
    input.seen.length > config.maxUrls ||
    input.sitemapPending.length > 20 ||
    input.sitemapSeen.length > 20
  ) invalid();
  const origin = new URL(config.startUrls[0]!).origin;
  const seen = input.seen.map((candidate: unknown) => {
    if (typeof candidate !== "string") invalid();
    const url = storedScopeUrl(candidate, config);
    if (new URL(url).origin !== origin) invalid();
    return url;
  });
  if (new Set(seen).size !== seen.length) invalid();
  const seenSet = new Set(seen);
  const pending = input.pending.map((candidate: unknown) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      Object.keys(candidate).length !== 3 ||
      !("url" in candidate) ||
      !("depth" in candidate) ||
      !("inSitemap" in candidate) ||
      typeof candidate.url !== "string" ||
      typeof candidate.inSitemap !== "boolean" ||
      !Number.isSafeInteger(candidate.depth) ||
      Number(candidate.depth) < 0 ||
      Number(candidate.depth) > config.maxDepth
    ) {
      invalid();
    }
    const item = candidate as Readonly<Record<string, unknown>>;
    const url = storedScopeUrl(
      item.url as string,
      config
    );
    if (new URL(url).origin !== origin || !seenSet.has(url)) invalid();
    return {
      url,
      depth: Number(item.depth),
      inSitemap: item.inSitemap as boolean
    };
  });
  if (new Set(pending.map(({ url }) => url)).size !== pending.length) {
    invalid();
  }
  const sitemapSeen = input.sitemapSeen.map((candidate: unknown) =>
    storedSitemapUrl(candidate, origin)
  );
  if (new Set(sitemapSeen).size !== sitemapSeen.length) invalid();
  const sitemapSet = new Set(sitemapSeen);
  const sitemapPending = input.sitemapPending.map((candidate: unknown) => {
    const url = storedSitemapUrl(candidate, origin);
    if (!sitemapSet.has(url)) invalid();
    return url;
  });
  if (
    new Set(sitemapPending).size !== sitemapPending.length ||
    (input.scopeReady && sitemapPending.length > 0)
  ) {
    invalid();
  }
  return {
    version: 2,
    pending,
    seen,
    sitemapPending,
    sitemapSeen,
    scopeReady: input.scopeReady
  };
}

export function crawlCheckpointJson(
  checkpoint: CrawlCheckpoint
): Prisma.InputJsonValue {
  return {
    version: 2,
    pending: checkpoint.pending.map(({ url, depth, inSitemap }) => ({
      url,
      depth,
      inSitemap
    })),
    seen: [...checkpoint.seen],
    sitemapPending: [...checkpoint.sitemapPending],
    sitemapSeen: [...checkpoint.sitemapSeen],
    scopeReady: checkpoint.scopeReady
  };
}

function storedLegacyCheckpoint(
  input: Readonly<Record<string, unknown>>,
  config: TechnicalCrawlConfig
): CrawlCheckpoint {
  if (config.sitemapUrls.length > 0) invalid();
  const upgraded = storedCrawlCheckpoint(
    {
      ...input,
      version: 2,
      pending: Array.isArray(input.pending)
        ? input.pending.map((candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            !Array.isArray(candidate)
              ? { ...candidate, inSitemap: false }
              : candidate
          )
        : input.pending,
      sitemapPending: [],
      sitemapSeen: [],
      scopeReady: true
    },
    config
  );
  return upgraded;
}

function storedScopeUrl(
  value: string,
  config: TechnicalCrawlConfig
): string {
  let url: string;
  try {
    url = normalizedScopeUrl(value, config.queryPolicy);
  } catch {
    return invalid();
  }
  if (
    !crawlScopeAllows(url, config) &&
    !config.startUrls.includes(url)
  ) {
    invalid();
  }
  return url;
}

function storedSitemapUrl(value: unknown, origin: string): string {
  if (typeof value !== "string") invalid();
  let url: string;
  try {
    url = normalizedScopeUrl(value, "PRESERVE");
  } catch {
    return invalid();
  }
  if (new URL(url).origin !== origin) invalid();
  return url;
}

function invalid(): never {
  throw new TypeError("Stored crawl checkpoint is invalid");
}
