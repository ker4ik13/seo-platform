import type { SemanticOperationScopePageInput } from "@seo-platform/contracts";

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
