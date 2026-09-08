import type { PendingWorkspaceInviteSummary } from "@seo-platform/contracts";
import {
  pendingInviteAccessLabel,
  pendingInviteRoleLabel
} from "../lib/workspace-invitations";
import { UiText, UiElement } from "./ui-locale";
import { useUiLocale } from "./ui-locale";



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
  const uiLocale = useUiLocale().locale;
  if (invites.length === 0) return null;
  return (
    <UiElement tag="section" uiLabels={{"aria-label": "Приглашения в рабочие области"}}

      className={compact ? "workspace-invites compact" : "panel workspace-invites"}
    >
      <header>
        <div>
          <span><UiText text="Требуют решения" /></span>
          <h2><UiText text="Приглашения в команду" /></h2>
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
                <span><UiText text="Вас приглашают в рабочую область" /></span>
                <h3>{invite.workspaceName}</h3>
                <p>
                  {<UiText text={pendingInviteRoleLabel(invite) ?? ""} />} · {<UiText text={pendingInviteAccessLabel(invite) ?? ""} />}
                </p>
                {invite.message && <blockquote>{<UiText text={invite.message ?? ""} />}</blockquote>}
                <small>
                  <UiText text="Действует до" />{" "}
                  <time dateTime={invite.expiresAt}>
                    {formatInviteDate(invite.expiresAt, uiLocale)}
                  </time>
                </small>
                <div className="workspace-invite-actions">
                  <button
                    className="primary-button"
                    disabled={busy || invite.workspaceStatus === "SUSPENDED"}
                    onClick={() => onAccept(invite)}
                    type="button"
                  >
                    {busy ? <UiText text="Сохраняем…" /> : <UiText text="Принять" />}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => onDecline(invite)}
                    type="button"
                  >
                    <UiText text="Отклонить" /></button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </UiElement>
  );
}

function formatInviteDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
