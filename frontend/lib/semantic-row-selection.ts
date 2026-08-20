export interface SemanticHighlightState {
  readonly anchorId: string;
  readonly highlightedIds: ReadonlySet<string>;
}

export interface SemanticSelectableGroup {
  readonly id: string;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

export function semanticHighlightAfterRowClick(
  orderedIds: readonly string[],
  anchorId: string | undefined,
  targetId: string,
  extendRange: boolean
): SemanticHighlightState {
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
  if (!extendRange || targetIndex < 0 || anchorIndex < 0) {
    return {
      anchorId: targetId,
      highlightedIds: new Set([targetId])
    };
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return {
    anchorId: anchorId ?? targetId,
    highlightedIds: new Set(orderedIds.slice(start, end + 1))
  };
}

export function semanticClipboardText<Row extends Readonly<{
  id: string;
  textOriginal: string;
}>>(
  orderedRows: readonly Row[],
  highlightedIds: ReadonlySet<string>
): string {
  return orderedRows
    .filter(({ id }) => highlightedIds.has(id))
    .map(({ textOriginal }) => textOriginal)
    .join("\n");
}

export function toggleSemanticHighlightedSelection(
  selectedIds: ReadonlySet<string>,
  highlightedIds: ReadonlySet<string>
): ReadonlySet<string> {
  const next = new Set(selectedIds);
  if (highlightedIds.size === 0) return next;
  const allHighlightedSelected = [...highlightedIds].every((id) => next.has(id));
  for (const id of highlightedIds) {
    if (allHighlightedSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function initialSemanticCreateGroupId(
  activeGroupId: string | undefined,
  groups: readonly SemanticSelectableGroup[]
): string {
  const ungroupedId = groups.find(
    ({ systemKind }) => systemKind === "UNGROUPED"
  )?.id ?? "";
  if (!activeGroupId) return ungroupedId;
  const activeGroup = groups.find(({ id }) => id === activeGroupId);
  return activeGroup && activeGroup.systemKind !== "TRASH"
    ? activeGroup.id
    : ungroupedId;
}

export function semanticBulkSelectionBatches<Item>(
  items: readonly Item[],
  maximumBatchSize: number
): readonly Item[][] {
  if (!Number.isSafeInteger(maximumBatchSize) || maximumBatchSize < 1) {
    throw new RangeError("maximumBatchSize must be a positive integer");
  }
  const batches: Item[][] = [];
  for (let offset = 0; offset < items.length; offset += maximumBatchSize) {
    batches.push(items.slice(offset, offset + maximumBatchSize));
  }
  return batches;
}
