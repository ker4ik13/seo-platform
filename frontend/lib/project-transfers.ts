import type {
  ProjectTransferRequestSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  type BrowserApiCollection
} from "./browser-api";
export { projectTransferDestinations } from "./project-transfer-destinations";

export type ProjectTransferDecision = "accept" | "decline";

export function loadPendingProjectTransfers(
  signal?: AbortSignal
): Promise<BrowserApiCollection<ProjectTransferRequestSummary>> {
  return browserApiCollectionRequest<ProjectTransferRequestSummary>(
    "/app/api/me/project-transfers",
    signal ? { signal } : {}
  );
}

export function decideProjectTransfer(
  transferId: string,
  decision: ProjectTransferDecision,
  destinationWorkspaceId?: string
): Promise<ProjectTransferRequestSummary> {
  if (decision === "accept" && !destinationWorkspaceId) {
    throw new Error("Destination workspace is required");
  }
  return browserApiRequest<ProjectTransferRequestSummary>(
    `/app/api/project-transfers/${encodeURIComponent(transferId)}/${decision}`,
    {
      method: "POST",
      ...(decision === "accept"
        ? { body: { destinationWorkspaceId } }
        : {})
    }
  );
}

export async function loadProjectTransferWorkspaces(
  signal?: AbortSignal
): Promise<readonly WorkspaceSummary[]> {
  const result = await browserApiCollectionRequest<WorkspaceSummary>(
    "/app/api/workspaces",
    signal ? { signal } : {}
  );
  return result.data;
}

export function activateTransferredProject(
  transfer: ProjectTransferRequestSummary
): void {
  if (transfer.status !== "ACCEPTED" || !transfer.destinationWorkspaceId) {
    throw new Error("Transferred project is not ready");
  }
  writePreference("seo_workspace", transfer.destinationWorkspaceId);
  writePreference("seo_project", transfer.projectId);
  window.location.assign(
    `/app/projects/${encodeURIComponent(transfer.projectId)}/settings/general`
  );
}

function writePreference(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
