export interface ClusterFolderDecision {
  readonly action: "NEW" | "KEEP" | "EXISTING";
  readonly groupId?: string;
  readonly parentGroupId?: string;
}

export function rememberClusterFolderAction(
  previous: ClusterFolderDecision | undefined,
  action: ClusterFolderDecision["action"]
): ClusterFolderDecision {
  return { ...previous, action };
}

export function rememberClusterFolderDestination(
  decision: ClusterFolderDecision,
  groupId: string
): ClusterFolderDecision {
  if (decision.action === "EXISTING") {
    return groupId ? { ...decision, groupId } : decision;
  }
  if (groupId) {
    return { ...decision, action: "NEW", parentGroupId: groupId };
  }
  const { parentGroupId: _removedParentGroupId, ...remembered } = decision;
  return { ...remembered, action: "NEW" };
}

export function serializeClusterFolderOverride(
  proposalClusterId: string,
  override: ClusterFolderDecision
) {
  if (override.action === "NEW") {
    return {
      proposalClusterId,
      action: override.action,
      ...(override.parentGroupId ? { parentGroupId: override.parentGroupId } : {})
    };
  }
  if (override.action === "EXISTING") {
    return {
      proposalClusterId,
      action: override.action,
      ...(override.groupId ? { groupId: override.groupId } : {})
    };
  }
  return { proposalClusterId, action: override.action };
}
