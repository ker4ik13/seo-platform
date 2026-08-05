import type { SemanticKeywordCleaningRules } from "@seo-platform/contracts";

export function cleanKeywordText(
  source: string,
  rules: SemanticKeywordCleaningRules
): string {
  let value = source;
  if (rules.normalizeQuotes) {
    value = value
      .replace(/[«»„“”]/gu, '"')
      .replace(/[‘’‚‛]/gu, "'");
  }
  if (rules.normalizeDashes) {
    value = value.replace(/[‐‑‒–—―−]/gu, "-");
  }
  if (rules.normalizeYo) {
    value = value.replace(/ё/gu, "е").replace(/Ё/gu, "Е");
  }
  if (rules.removeSearchOperators) {
    value = value
      .replace(/<</gu, " ")
      .replace(/[[\]()"|]/gu, " ")
      .replace(/(^|\s)[!+]+(?=\S)/gu, "$1")
      .replace(/(^|\s)-(?=\S)/gu, "$1")
      .replace(/\s+/gu, " ")
      .trim();
  }
  if (rules.letterCase === "LOWER") value = value.toLowerCase();
  if (rules.letterCase === "UPPER") value = value.toUpperCase();
  if (rules.collapseWhitespace) {
    value = value.replace(/\s+/gu, " ").trim();
  }
  return value;
}
