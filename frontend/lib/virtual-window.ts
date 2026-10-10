export interface VirtualWindow {
  readonly start: number;
  readonly end: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}

/** Fixed-height window; indices always refer to the complete server order. */
export function virtualWindow(
  count: number,
  viewport: Readonly<{ height: number; scrollTop: number }>,
  rowHeight: number,
  headerHeight = 0,
  overscan = 12,
  threshold = 0
): VirtualWindow {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) {
    throw new RangeError("Invalid virtual window dimensions");
  }
  if (count <= threshold) return { start: 0, end: count, paddingTop: 0, paddingBottom: 0 };
  const visible = Math.max(1, Math.ceil(Math.max(0, viewport.height) / rowHeight)) + overscan * 2;
  const start = Math.min(Math.max(0, count - visible), Math.max(0,
    Math.floor(Math.max(0, viewport.scrollTop - headerHeight) / rowHeight) - overscan));
  const end = Math.min(count, start + visible);
  return { start, end, paddingTop: start * rowHeight, paddingBottom: (count - end) * rowHeight };
}
