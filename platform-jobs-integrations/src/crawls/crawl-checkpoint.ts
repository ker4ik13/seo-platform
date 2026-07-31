import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export interface CrawlPendingUrl {
  readonly url: string;
  readonly depth: number;
}

export interface CrawlCheckpoint {
  readonly version: 1;
  readonly pending: readonly CrawlPendingUrl[];
  readonly seen: readonly string[];
}

export function initialCrawlCheckpoint(
  config: TechnicalCrawlConfig
): CrawlCheckpoint {
  const startUrls = config.startUrls.map(normalizedUrl);
  return {
    version: 1,
    pending: startUrls.map((url) => ({ url, depth: 0 })),
    seen: startUrls
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
  if (
    input.version !== 1 ||
    !Array.isArray(input.pending) ||
    !Array.isArray(input.seen) ||
    input.pending.length > config.maxUrls ||
    input.seen.length > config.maxUrls
  ) invalid();
  const origin = new URL(config.startUrls[0]!).origin;
  const seen = input.seen.map((candidate: unknown) => {
    if (typeof candidate !== "string") invalid();
    const url = normalizedUrl(candidate);
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
      Object.keys(candidate).length !== 2 ||
      !("url" in candidate) ||
      !("depth" in candidate) ||
      typeof candidate.url !== "string" ||
      !Number.isSafeInteger(candidate.depth) ||
      Number(candidate.depth) < 0 ||
      Number(candidate.depth) > config.maxDepth
    ) {
      invalid();
    }
    const item = candidate as Readonly<Record<string, unknown>>;
    const url = normalizedUrl(item.url as string);
    if (new URL(url).origin !== origin || !seenSet.has(url)) invalid();
    return { url, depth: Number(item.depth) };
  });
  if (new Set(pending.map(({ url }) => url)).size !== pending.length) {
    invalid();
  }
  return { version: 1, pending, seen };
}

export function crawlCheckpointJson(
  checkpoint: CrawlCheckpoint
): Prisma.InputJsonValue {
  return {
    version: 1,
    pending: checkpoint.pending.map(({ url, depth }) => ({ url, depth })),
    seen: [...checkpoint.seen]
  };
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid();
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  return url.toString();
}

function invalid(): never {
  throw new TypeError("Stored crawl checkpoint is invalid");
}
