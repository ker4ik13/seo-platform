export type SemanticGroupDropPlacement = "before" | "inside" | "after";

export function semanticGroupDropPlacement(
  pointerY: number,
  rowTop: number,
  rowHeight: number
): SemanticGroupDropPlacement {
  if (!Number.isFinite(pointerY) || !Number.isFinite(rowTop) || rowHeight <= 0) {
    return "inside";
  }
  const ratio = (pointerY - rowTop) / rowHeight;
  if (ratio < 0.28) return "before";
  if (ratio > 0.72) return "after";
  return "inside";
}
