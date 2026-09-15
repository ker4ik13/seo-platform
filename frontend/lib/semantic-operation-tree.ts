export interface SemanticOperationTreeNode {
  readonly id: string;
  readonly parentId?: string;
}

export interface VisibleFolderRow<
  Group extends SemanticOperationTreeNode = SemanticOperationTreeNode
> {
  readonly group: Group;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function visibleFolderRows<Group extends SemanticOperationTreeNode>(
  groups: readonly Group[],
  expandedIds: ReadonlySet<string>
): readonly VisibleFolderRow<Group>[] {
  const byParent = new Map<string | undefined, Group[]>();
  const groupIds = new Set(groups.map(({ id }) => id));
  for (const group of groups) {
    const parentId = group.parentId && groupIds.has(group.parentId)
      ? group.parentId
      : undefined;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(group);
    byParent.set(parentId, siblings);
  }
  const rows: VisibleFolderRow<Group>[] = [];
  const visited = new Set<string>();
  const append = (parentId: string | undefined, depth: number): void => {
    for (const group of byParent.get(parentId) ?? []) {
      if (visited.has(group.id)) continue;
      visited.add(group.id);
      const hasChildren = (byParent.get(group.id)?.length ?? 0) > 0;
      rows.push({ group, depth, hasChildren });
      if (hasChildren && expandedIds.has(group.id)) {
        append(group.id, depth + 1);
      }
    }
  };
  append(undefined, 0);
  return rows;
}

export function expandedAncestorIds<Group extends SemanticOperationTreeNode>(
  groups: readonly Group[],
  selectedIds: Iterable<string>
): ReadonlySet<string> {
  const parentById = new Map(groups.map(({ id, parentId }) => [id, parentId]));
  const expanded = new Set<string>();
  for (const selectedId of selectedIds) {
    let current = parentById.get(selectedId);
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      expanded.add(current);
      current = parentById.get(current);
    }
  }
  return expanded;
}

export function treeIdsWithDescendants<Group extends SemanticOperationTreeNode>(
  groups: readonly Group[],
  selectedIds: ReadonlySet<string>
): readonly string[] {
  const result = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && result.has(group.parentId) && !result.has(group.id)) {
        result.add(group.id);
        changed = true;
      }
    }
  }
  return [...result].sort();
}

export function resolvedFolderSelectionIds<
  Group extends SemanticOperationTreeNode
>(
  groups: readonly Group[],
  selectedIds: ReadonlySet<string>,
  descendantRootIds: ReadonlySet<string> = new Set()
): readonly string[] {
  const selectedDescendantRoots = new Set(
    [...descendantRootIds].filter((groupId) => selectedIds.has(groupId))
  );
  return [
    ...new Set([
      ...selectedIds,
      ...treeIdsWithDescendants(groups, selectedDescendantRoots)
    ])
  ].sort();
}
