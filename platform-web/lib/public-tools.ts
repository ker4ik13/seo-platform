export const PUBLIC_KEYWORD_LIMIT = 500;
export const PUBLIC_KEYWORD_TEXT_LIMIT = 20_000;

export interface PublicKeywordCleanupResult {
  readonly keywords: readonly string[];
  readonly sourceRows: number;
  readonly emptyRows: number;
  readonly duplicateRows: number;
  readonly truncatedRows: number;
}

export function cleanPublicKeywords(value: string): PublicKeywordCleanupResult {
  const bounded = value.slice(0, PUBLIC_KEYWORD_TEXT_LIMIT);
  const rows = bounded.split(/\r?\n/u);
  const seen = new Set<string>();
  const keywords: string[] = [];
  let emptyRows = 0;
  let duplicateRows = 0;
  let truncatedRows = 0;

  for (const row of rows) {
    const normalized = normalizePublicKeyword(row);
    if (!normalized) {
      emptyRows += 1;
      continue;
    }
    const identity = normalized.toLocaleLowerCase("ru-RU");
    if (seen.has(identity)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(identity);
    if (keywords.length >= PUBLIC_KEYWORD_LIMIT) {
      truncatedRows += 1;
      continue;
    }
    keywords.push(normalized);
  }

  return {
    keywords,
    sourceRows: rows.length,
    emptyRows,
    duplicateRows,
    truncatedRows
  };
}

export function normalizePublicKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[«»„“”]/gu, '"')
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

export function snippetLengthState(
  value: string,
  recommended: number
): "EMPTY" | "OK" | "LONG" {
  if (value.trim().length === 0) return "EMPTY";
  return value.length <= recommended ? "OK" : "LONG";
}
