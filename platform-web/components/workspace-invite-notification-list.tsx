import type { PendingWorkspaceInviteSummary } from "@seo-platform/contracts";
import {
  pendingInviteAccessLabel,
  pendingInviteRoleLabel
} from "../lib/workspace-invitations";

export function WorkspaceInviteNotificationList({
  invites,
  busyInviteId,
  compact = false,
  onAccept,
  onDecline
}: Readonly<{
  invites: readonly PendingWorkspaceInviteSummary[];
  busyInviteId?: string;
  compact?: boolean;
  onAccept: (invite: PendingWorkspaceInviteSummary) => void;
  onDecline: (invite: PendingWorkspaceInviteSummary) => void;
}>) {
  if (invites.length === 0) return null;
  return (
    <section
      aria-label="Приглашения в рабочие области"
      className={compact ? "workspace-invites compact" : "panel workspace-invites"}
    >
      <header>
        <div>
          <span>Требуют решения</span>
          <h2>Приглашения в команду</h2>
        </div>
        <strong>{invites.length}</strong>
      </header>
      <div className="workspace-invite-list">
        {invites.map((invite) => {
          const busy = busyInviteId === invite.id;
          return (
            <article className="workspace-invite-card" key={invite.id}>
              <div className="workspace-invite-mark" aria-hidden="true">
                {invite.workspaceName.trim().slice(0, 1).toLocaleUpperCase("ru-RU") || "S"}
              </div>
              <div className="workspace-invite-copy">
                <span>Вас приглашают в рабочую область</span>
                <h3>{invite.workspaceName}</h3>
                <p>
                  {pendingInviteRoleLabel(invite)} · {pendingInviteAccessLabel(invite)}
                </p>
                {invite.message && <blockquote>{invite.message}</blockquote>}
                <small>
                  Действует до{" "}
                  <time dateTime={invite.expiresAt}>
                    {formatInviteDate(invite.expiresAt)}
                  </time>
                </small>
                <div className="workspace-invite-actions">
                  <button
                    className="primary-button"
                    disabled={busy || invite.workspaceStatus === "SUSPENDED"}
                    onClick={() => onAccept(invite)}
                    type="button"
                  >
                    {busy ? "Сохраняем…" : "Принять"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => onDecline(invite)}
                    type="button"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatInviteDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
