export function semanticGroupRangeSelection(
  visibleIds: readonly string[],
  anchorId: string,
  targetId: string
): ReadonlySet<string> | undefined {
  const anchorIndex = visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return undefined;
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return new Set(visibleIds.slice(start, end + 1));
}

export function semanticAllRegularGroupIds(
  groups: readonly Readonly<{ id: string; systemKind?: string }>[]
): readonly string[] {
  return groups
    .filter(({ systemKind }) => !systemKind)
    .map(({ id }) => id);
}

/**
 * Returns the single row that should carry a remote participant marker.
 * A selected child wins while it is visible; for a collapsed branch the
 * marker rolls up to the nearest visible ancestor instead of lighting the
 * whole ancestry chain.
 */
export function semanticVisiblePresenceGroupId(
  selectedGroupIds: readonly string[],
  groups: readonly Readonly<{ id: string; parentId?: string }>[],
  visibleGroupIds: readonly string[]
): string | undefined {
  if (selectedGroupIds.length === 0 || visibleGroupIds.length === 0) {
    return undefined;
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const visibleIndex = new Map(
    visibleGroupIds.map((groupId, index) => [groupId, index])
  );
  const candidates = new Set<string>();

  for (const selectedGroupId of selectedGroupIds) {
    let current = groupById.get(selectedGroupId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (visibleIndex.has(current.id)) {
        candidates.add(current.id);
        break;
      }
      current = current.parentId
        ? groupById.get(current.parentId)
        : undefined;
    }
  }

  return [...candidates].sort(
    (left, right) =>
      (visibleIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (visibleIndex.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right)
  )[0];
}
