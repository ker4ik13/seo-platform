import type { SemanticOperationScopePageInput } from "@seo-platform/contracts";

export function semanticOperationScopeResolutionKey(input: {
  readonly mode: string;
  readonly selectedGroupIds: readonly string[];
  readonly descendantGroupIds: readonly string[];
  readonly resolvedGroupIds: readonly string[];
  readonly querySelections: readonly Readonly<{
    id: string;
    version: number;
    isTracked?: boolean;
  }>[];
}): string {
  return JSON.stringify({
    mode: input.mode,
    selectedGroupIds: [...input.selectedGroupIds].sort(),
    descendantGroupIds: [...input.descendantGroupIds].sort(),
    resolvedGroupIds: [...input.resolvedGroupIds].sort(),
    querySelections: [...input.querySelections]
      .map(({ id, version, isTracked }) => [id, version, isTracked ?? true])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  });
}

/**
 * Builds one lightweight server page. Full keyword metrics never enter scope
 * preparation for a large operation.
 */
export function semanticOperationScopePageInput(
  groupIds: readonly string[] | undefined,
  cursor?: string
): SemanticOperationScopePageInput {
  return {
    ...(groupIds?.length ? { groupIds: [...groupIds] } : {}),
    ...(cursor ? { cursor } : {})
  };
}
