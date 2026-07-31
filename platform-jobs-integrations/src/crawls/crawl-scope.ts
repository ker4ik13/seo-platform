import type {
  TechnicalCrawlConfig,
  TechnicalCrawlQueryPolicy
} from "@seo-platform/contracts";
import { assertSafeCrawlUrl } from "./public-http.js";

const TRACKING_PARAMETERS = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "wbraid",
  "yclid",
  "ysclid"
]);

export function normalizedScopeUrl(
  value: string,
  queryPolicy: TechnicalCrawlQueryPolicy
): string {
  const url = assertSafeCrawlUrl(value);
  url.hash = "";
  if (queryPolicy === "DROP_ALL") {
    url.search = "";
  } else if (queryPolicy === "DROP_TRACKING") {
    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLowerCase();
      if (
        normalized.startsWith("utm_") ||
        TRACKING_PARAMETERS.has(normalized)
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
  }
  return url.toString();
}

export function crawlScopeAllows(
  value: string,
  config: Pick<
    TechnicalCrawlConfig,
    "includePatterns" | "excludePatterns"
  >
): boolean {
  const url = new URL(value);
  const target = `${url.pathname}${url.search}`;
  const included =
    config.includePatterns.length === 0 ||
    config.includePatterns.some((pattern) => globMatches(pattern, target));
  return (
    included &&
    !config.excludePatterns.some((pattern) => globMatches(pattern, target))
  );
}

export function validCrawlPathPattern(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value.length <= 200 &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || character === "#";
    })
  );
}

function globMatches(pattern: string, value: string): boolean {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`${source}$`, "u").test(value);
}

function escapeRegExp(value: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(value) ? `\\${value}` : value;
}
