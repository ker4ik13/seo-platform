export type SemanticGroupDropPlacement = "before" | "inside" | "after";

export interface SemanticGroupCanonicalDropTarget<T> {
  readonly group: T;
  readonly placement: SemanticGroupDropPlacement;
}

export interface SemanticGroupVisibleDropRow<T> {
  readonly group: T;
  readonly depth: number;
}

export function semanticGroupDropPlacement(
  pointerY: number,
  rowTop: number,
  rowHeight: number
): SemanticGroupDropPlacement {
  if (!Number.isFinite(pointerY) || !Number.isFinite(rowTop) || rowHeight <= 0) {
    return "inside";
  }
  const ratio = (pointerY - rowTop) / rowHeight;
  if (ratio < 0.36) return "before";
  if (ratio > 0.64) return "after";
  return "inside";
}

/**
 * Equal-level gaps and transitions into a subtree have one canonical target.
 * When a subtree ends, both levels are intentionally preserved: the lower
 * edge of its final row appends inside that subtree, while the upper edge of
 * the following shallower row inserts before that row on the outer level.
 */
export function semanticGroupCanonicalDropTarget<T>(
  pointerY: number,
  rowTop: number,
  rowHeight: number,
  row: SemanticGroupVisibleDropRow<T>,
  nextVisibleRow?: SemanticGroupVisibleDropRow<T>
): SemanticGroupCanonicalDropTarget<T> {
  const placement = semanticGroupDropPlacement(pointerY, rowTop, rowHeight);
  if (
    placement === "after" &&
    nextVisibleRow !== undefined &&
    nextVisibleRow.depth >= row.depth
  ) {
    return { group: nextVisibleRow.group, placement: "before" };
  }
  return { group: row.group, placement };
}
