export const EARLIEST_SEMANTIC_SERP_HISTORY_INSTANT =
  "1970-01-01T00:00:00.000Z";

export function semanticSerpHistoryQuery(input: Readonly<{
  before: string;
  cursor?: string;
  dimensionKey?: string;
  keywordId: string;
}>): URLSearchParams {
  return new URLSearchParams({
    keywordId: input.keywordId,
    observedFrom: EARLIEST_SEMANTIC_SERP_HISTORY_INSTANT,
    observedBefore: input.before,
    limit: "5",
    mode: "SERP",
    ...(input.dimensionKey ? { dimensionKey: input.dimensionKey } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {})
  });
}
