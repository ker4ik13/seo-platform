interface Rectangle {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

/** Fixed viewport coordinates: the calendar never takes space in its parent form. */
export function dateRangePopoverPosition({ anchor, height, viewport, mode, width: preferredWidth = 640 }: Readonly<{
  anchor: Rectangle;
  height: number;
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>;
  mode: "ANCHORED" | "CENTERED" | "SHEET";
  width?: number;
}>) {
  const padding = 12;
  const gap = 8;
  const width = Math.min(preferredWidth, Math.max(0, viewport.width - padding * 2));
  const maxHeight = Math.max(0, viewport.height - padding * 2);
  const visibleHeight = Math.min(height, maxHeight);
  const topLimit = viewport.top + padding;
  const bottomLimit = viewport.top + viewport.height - padding;
  const spaceBelow = bottomLimit - anchor.bottom - gap;
  const spaceAbove = anchor.top - gap - topLimit;
  const upward = mode === "ANCHORED" && spaceBelow < visibleHeight && spaceAbove > spaceBelow;
  const desiredTop = mode === "CENTERED"
    ? viewport.top + (viewport.height - visibleHeight) / 2
    : mode === "SHEET"
      ? bottomLimit - visibleHeight
      : upward ? anchor.top - gap - visibleHeight : anchor.bottom + gap;
  return {
    width,
    maxHeight,
    left: mode === "ANCHORED"
      ? Math.max(viewport.left + padding, Math.min(anchor.left, viewport.left + viewport.width - width - padding))
      : viewport.left + (viewport.width - width) / 2,
    top: Math.max(topLimit, Math.min(desiredTop, bottomLimit - visibleHeight)),
  };
}
