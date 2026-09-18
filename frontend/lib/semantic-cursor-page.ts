export type SemanticCursorPageIssue =
  | "NO_PROGRESS"
  | "REPEATED_CURSOR";

export function semanticCursorPageIssue(input: {
  readonly requestedCursor: string;
  readonly nextCursor?: string;
  readonly hasNext: boolean;
  readonly loadedIds: ReadonlySet<string>;
  readonly returnedIds: readonly string[];
  readonly seenCursors: ReadonlySet<string>;
}): SemanticCursorPageIssue | undefined {
  if (!input.hasNext) return undefined;
  if (
    !input.nextCursor ||
    input.nextCursor === input.requestedCursor ||
    input.seenCursors.has(input.nextCursor)
  ) {
    return "REPEATED_CURSOR";
  }
  return input.returnedIds.every(id => input.loadedIds.has(id))
    ? "NO_PROGRESS"
    : undefined;
}
