import type {
  ProjectTransferRequestSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";

export function projectTransferDestinations(
  workspaces: readonly WorkspaceSummary[],
  transfer: ProjectTransferRequestSummary
): readonly WorkspaceSummary[] {
  return workspaces.filter(
    (workspace) =>
      workspace.id !== transfer.workspaceId &&
      workspace.status === "ACTIVE" &&
      ["OWNER", "ADMIN", "SEO_LEAD"].includes(workspace.roleCode)
  );
}
