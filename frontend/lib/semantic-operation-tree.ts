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
