export interface SemanticHighlightState {
  readonly anchorId: string | undefined;
  readonly highlightedIds: ReadonlySet<string>;
}

export interface SemanticSelectionState extends SemanticHighlightState {
  readonly selectedIds: ReadonlySet<string>;
}

export interface SemanticHighlightModifiers {
  readonly additive: boolean;
  readonly extendRange: boolean;
}

export interface SemanticSelectableGroup {
  readonly id: string;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

export interface SemanticSelectionScopeFilters {
  readonly search?: string;
  readonly tag?: string;
  readonly intent?: string;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface SemanticSelectionScope {
  readonly projectId: string;
  readonly filters: SemanticSelectionScopeFilters;
  readonly groupIds?: readonly string[];
  readonly multiSearch?: Readonly<{
    readonly terms: readonly string[];
    readonly mode: string;
  }>;
}

export interface SemanticExportSelection {
  readonly keywordIds: readonly string[];
  readonly knownToContainNoTrackedKeywords: boolean;
}

/**
 * Export selection is authoritative independently of the currently loaded
 * presentation pages. Loaded rows are used only for a safe local empty-state
 * check when every selected ID is still present in memory.
 */
export function semanticExportSelection<Row extends Readonly<{
  id: string;
  isTracked: boolean;
}>>(
  selectedIds: ReadonlySet<string>,
  loadedRows: readonly Row[]
): SemanticExportSelection {
  const keywordIds = [...selectedIds];
  const loadedSelected = loadedRows.filter(({ id }) => selectedIds.has(id));
  return {
    keywordIds,
    knownToContainNoTrackedKeywords:
      keywordIds.length > 0 &&
      loadedSelected.length === keywordIds.length &&
      loadedSelected.every(({ isTracked }) => !isTracked)
  };
}

/**
 * Identifies the visible row scope without coupling selection to pagination,
 * sorting or background refresh counters.
 */
export function semanticSelectionScopeSignature(
  scope: SemanticSelectionScope
): string {
  const { filters } = scope;
  return JSON.stringify([
    scope.projectId,
    filters.search ?? null,
    filters.tag ?? null,
    filters.intent ?? null,
    filters.groupId ?? null,
    filters.clusterId ?? null,
    filters.isFavorite ?? null,
    filters.isTracked ?? null,
    filters.priorityMin ?? null,
    filters.priorityMax ?? null,
    [...new Set(scope.groupIds ?? [])].sort(),
    scope.multiSearch
      ? [scope.multiSearch.mode, ...scope.multiSearch.terms]
      : null
  ]);
}

export function semanticHighlightAfterRowClick(
  orderedIds: readonly string[],
  anchorId: string | undefined,
  targetId: string,
  highlightedIds: ReadonlySet<string>,
  modifiers: SemanticHighlightModifiers
): SemanticHighlightState {
  const targetIndex = orderedIds.indexOf(targetId);
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
  if (modifiers.extendRange && targetIndex >= 0 && anchorIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const next = modifiers.additive
      ? new Set(highlightedIds)
      : new Set<string>();
    for (const id of orderedIds.slice(start, end + 1)) next.add(id);
    return {
      anchorId: anchorId ?? targetId,
      highlightedIds: next
    };
  }

  if (modifiers.additive) {
    const next = new Set(highlightedIds);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    return {
      anchorId: targetId,
      highlightedIds: next
    };
  }

  return {
    anchorId: targetId,
    highlightedIds: new Set([targetId])
  };
}

export function semanticHighlightAllRows(
  orderedIds: readonly string[],
  preferredAnchorId: string | undefined
): SemanticHighlightState {
  return {
    anchorId:
      preferredAnchorId && orderedIds.includes(preferredAnchorId)
        ? preferredAnchorId
        : orderedIds[0],
    highlightedIds: new Set(orderedIds)
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

export function semanticSelectionAfterDeletion(
  selectedIds: ReadonlySet<string>,
  highlightedIds: ReadonlySet<string>,
  anchorId: string | undefined,
  deletedIds: ReadonlySet<string>
): SemanticSelectionState {
  const remainingSelected = new Set(
    [...selectedIds].filter((id) => !deletedIds.has(id))
  );
  const remainingHighlighted = new Set(
    [...highlightedIds].filter((id) => !deletedIds.has(id))
  );
  return {
    selectedIds: remainingSelected,
    highlightedIds: remainingHighlighted,
    anchorId: anchorId && !deletedIds.has(anchorId)
      ? anchorId
      : remainingHighlighted.values().next().value
  };
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
