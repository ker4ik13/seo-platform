export function normalizeKeywordText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}
