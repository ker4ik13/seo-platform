import type { SemanticRankComparisonItem } from "@seo-platform/contracts";


export function mergeRankComparisonItems(
  current: ReadonlyMap<string, SemanticRankComparisonItem>,
  next: ReadonlyMap<string, SemanticRankComparisonItem>
): ReadonlyMap<string, SemanticRankComparisonItem> {
  if (current.size === 0) return next;
  if (next.size === 0) return current;
  return new Map([...current, ...next]);
}
