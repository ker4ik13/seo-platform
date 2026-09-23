export function moveSemanticColumn<Column extends string>(
  order: readonly Column[],
  source: Column,
  target: Column,
  placement: "before" | "after"
): readonly Column[] {
  if (source === target || !order.includes(source) || !order.includes(target)) {
    return order;
  }
  const next = order.filter((column) => column !== source);
  const targetIndex = next.indexOf(target);
  if (targetIndex < 0) return order;
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
  return next;
}
