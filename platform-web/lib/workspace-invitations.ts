import type {
  PendingWorkspaceInviteSummary,
  WorkspaceInviteSummary,
  WorkspaceMemberSummary
} from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  type BrowserApiCollection
} from "./browser-api";
import { workspaceRoleLabel } from "./team-management";

export type WorkspaceInviteDecision = "accept" | "decline";

export function loadPendingWorkspaceInvites(
  signal?: AbortSignal
): Promise<BrowserApiCollection<PendingWorkspaceInviteSummary>> {
  return browserApiCollectionRequest<PendingWorkspaceInviteSummary>(
    "/app/api/me/workspace-invites",
    signal ? { signal } : {}
  );
}

export function decideWorkspaceInvite(
  inviteId: string,
  decision: "accept"
): Promise<WorkspaceMemberSummary>;
export function decideWorkspaceInvite(
  inviteId: string,
  decision: "decline"
): Promise<WorkspaceInviteSummary>;
export function decideWorkspaceInvite(
  inviteId: string,
  decision: WorkspaceInviteDecision
): Promise<WorkspaceMemberSummary | WorkspaceInviteSummary> {
  return browserApiRequest(
    `/app/api/workspace-invites/${encodeURIComponent(inviteId)}/${decision}`,
    { method: "POST" }
  );
}

export function activateAcceptedWorkspace(workspaceId: string): void {
  writePreference("seo_workspace", workspaceId);
  writePreference("seo_project", "");
  window.location.assign("/app");
}

export function pendingInviteRoleLabel(
  invite: PendingWorkspaceInviteSummary
): string {
  return workspaceRoleLabel(invite.roleCode);
}

export function pendingInviteAccessLabel(
  invite: PendingWorkspaceInviteSummary
): string {
  if (invite.allProjects) return "Все текущие и будущие проекты";
  const accessible = invite.projectAccesses.filter(
    ({ level }) => level !== "NONE"
  ).length;
  return accessible === 0
    ? "Без доступа к проектам"
    : `Доступ к проектам: ${accessible}`;
}

function writePreference(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!value) {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
