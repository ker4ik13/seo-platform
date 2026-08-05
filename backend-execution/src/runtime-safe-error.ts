export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  const errorWithCode = error as Error & { readonly code?: unknown };
  const code = typeof errorWithCode.code === "string" ? errorWithCode.code : error.name;
  const detail = error.message
    .split("\n")
    .findLast((line) => line.trim().length > 0)
    ?.replace(/\b(?:postgres(?:ql)?|redis|https?):\/\/\S+/giu, "[redacted-url]")
    .slice(0, 200);
  return detail ? `${code}:${detail}` : code;
}
