import { technicalCrawlRequestTimeoutMs, technicalCrawlMaxResponseBytes, type TechnicalCrawlConfig, type CrawlMetaTag, type CrawlTechnicalDetails } from "./crawls.js";

export const technicalCrawlRuntimeOptionKeys = ["conditionalRequests", "respectNofollow", "requestTimeoutMs", "maxResponseBytes", "maxRedirects"] as const;
export type TechnicalCrawlRuntimeOptions = Required<Pick<TechnicalCrawlConfig, typeof technicalCrawlRuntimeOptionKeys[number]>>;
export function parseTechnicalCrawlRuntimeOptions(value: Readonly<Record<string, unknown>>): TechnicalCrawlRuntimeOptions {
  const bool = (key: string, fallback: boolean) => { const v = value[key] === undefined ? fallback : value[key]; if (typeof v !== "boolean") invalid(); return v; };
  const number = (key: string, fallback: number, min: number, max: number) => { const v = value[key] === undefined ? fallback : value[key]; if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) invalid(); return v; };
  return { conditionalRequests: bool("conditionalRequests", value.purpose !== "HTTP_STATUS_CHECK"), respectNofollow: bool("respectNofollow", false), requestTimeoutMs: number("requestTimeoutMs", technicalCrawlRequestTimeoutMs, 1_000, 30_000), maxResponseBytes: number("maxResponseBytes", technicalCrawlMaxResponseBytes, 65_536, 4_194_304), maxRedirects: number("maxRedirects", 5, 0, 10) };
}

/** Validate the same bounded facts at the remote, persistence and public boundaries. */
export function parseCrawlTechnicalDetails(value: unknown): CrawlTechnicalDetails {
  const row = record(value, ["purpose", "responseHeadersCaptured", "robotsAccess", "links"]);
  if (row.responseHeadersCaptured !== undefined && typeof row.responseHeadersCaptured !== "boolean") invalid();
  if (row.purpose !== undefined && !["TECHNICAL_AUDIT", "HTTP_STATUS_CHECK"].includes(String(row.purpose))) invalid();
  const robotsAccess = row.robotsAccess === undefined ? undefined : array(row.robotsAccess, 3).map((value) => {
    const item = record(value, ["agent", "allowed", "group", "rule", "sourceUrl"]);
    if (!["seoplatformcrawler", "googlebot", "yandex"].includes(String(item.agent)) || typeof item.allowed !== "boolean") invalid();
    return { agent: item.agent as "seoplatformcrawler" | "googlebot" | "yandex", allowed: item.allowed, group: text(item.group, 200), sourceUrl: text(item.sourceUrl, 4_096), ...(item.rule === undefined ? {} : { rule: text(item.rule, 4_096) }) };
  });
  if (robotsAccess && new Set(robotsAccess.map(({ agent }) => agent)).size !== robotsAccess.length) invalid();
  const links = row.links === undefined ? undefined : array(row.links, 5_000).map((value) => {
    const item = record(value, ["url", "anchor", "rel", "kind"]);
    if (item.kind !== "INTERNAL" && item.kind !== "EXTERNAL") invalid();
    return { url: text(item.url, 4_096), anchor: text(item.anchor, 500), rel: array(item.rel, 20).map((value) => text(value, 64)), kind: item.kind as "INTERNAL" | "EXTERNAL" };
  });
  return { ...(row.purpose === undefined ? {} : { purpose: row.purpose as "TECHNICAL_AUDIT" | "HTTP_STATUS_CHECK" }), ...(row.responseHeadersCaptured === undefined ? {} : { responseHeadersCaptured: row.responseHeadersCaptured as boolean }), ...(robotsAccess ? { robotsAccess } : {}), ...(links ? { links } : {}) };
}

/** Directives remain scoped to the requested crawler, with the restrictive rule winning. */
export function crawlIndexingDirectives(tags: readonly CrawlMetaTag[], agent: "robots" | "googlebot" | "yandex") {
  const meta: string[] = [], headers: string[] = [];
  for (const tag of tags) {
    if (tag.source === "HTTP" && tag.httpEquiv?.toLowerCase() === "x-robots-tag") {
      for (const line of tag.content.split(/\r?\n/u)) {
        let scope = "robots";
        for (const part of line.split(",")) {
          const match = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*)$/iu.exec(part);
          const directive = match && !["unavailable_after", "max-snippet", "max-image-preview", "max-video-preview"].includes(match[1]!.toLowerCase());
          if (directive) scope = match[1]!.toLowerCase();
          if (scope === "robots" || scope === agent) headers.push((directive ? match[2]! : part).trim());
        }
      }
    } else if (tag.source !== "HTTP" && ["robots", agent].includes(tag.name?.toLowerCase() ?? "")) {
      meta.push(tag.content);
    }
  }
  const tokens = new Set([...meta, ...headers].flatMap((value) => value.toLowerCase().split(/[\s,]+/u)));
  return { noindex: tokens.has("noindex") || tokens.has("none"), nofollow: tokens.has("nofollow") || tokens.has("none"), meta, headers };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key))) invalid();
  return row;
}
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function text(value: unknown, max: number): string { if (typeof value !== "string" || value.length > max) invalid(); return value; }
function invalid(): never { throw new TypeError("Invalid crawl technical facts"); }
