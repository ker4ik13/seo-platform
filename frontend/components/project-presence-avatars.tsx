"use client";

import { useEffect, useState } from "react";
import {
  projectPresenceAvatarUrl,
  projectPresenceInitials,
  projectPresenceRouteLabel,
  type ActiveProjectParticipant
} from "../lib/project-presence";
import { useProjectPresence } from "./project-presence-provider";

const MAX_VISIBLE_PARTICIPANTS = 5;

export function ProjectPresenceAvatars() {
  const {
    activeParticipants,
    connectionStatus,
    currentUserId,
    projectId,
    setShowRemoteActivity,
    showRemoteActivity
  } = useProjectPresence();
  if (!projectId) return null;
  const remoteActiveParticipants = activeParticipants.filter(
    (active) =>
      active.userId !== currentUserId &&
      active.participant.status === "ACTIVE"
  );
  const visible = remoteActiveParticipants.slice(0, MAX_VISIBLE_PARTICIPANTS);
  const overflow = Math.max(
    0,
    remoteActiveParticipants.length - visible.length
  );
  const statusLabel =
    connectionStatus === "CONNECTED"
      ? "Совместная работа подключена"
      : connectionStatus === "CONNECTING"
        ? "Подключаем совместную работу"
        : "Совместная работа временно переподключается";

  return (
    <div
      aria-label={`${statusLabel}. Других активных участников: ${remoteActiveParticipants.length}`}
      className={`project-presence-avatars status-${connectionStatus.toLowerCase()}`}
      role="group"
    >
      {visible.map((active) => (
        <span
          className={`project-presence-avatar-wrap presence-color-${active.colorIndex} participant-${active.participant.status.toLowerCase()}`}
          key={active.userId}
          title={participantTitle(active)}
        >
          <ProjectParticipantAvatar
            active={active}
            projectId={projectId}
          />
          <i aria-hidden="true" />
        </span>
      ))}
      {overflow > 0 && (
        <span
          aria-label={`Ещё активных участников: ${overflow}`}
          className="project-presence-overflow"
          title={`Ещё ${overflow}`}
        >
          +{overflow}
        </span>
      )}
      {connectionStatus === "DEGRADED" && (
        <span
          aria-hidden="true"
          className="project-presence-connection-indicator"
          title={statusLabel}
        />
      )}
      <button
        aria-pressed={showRemoteActivity}
        className={`project-presence-visibility-toggle${showRemoteActivity ? " active" : ""}`}
        onClick={() => setShowRemoteActivity(!showRemoteActivity)}
        title={
          showRemoteActivity
            ? "Скрыть курсоры и действия участников"
            : "Показать курсоры и действия участников"
        }
        type="button"
      >
        <span aria-hidden="true">{showRemoteActivity ? "◉" : "○"}</span>
        Показывать курсоры
      </button>
      <span className="visually-hidden" role="status">
        {statusLabel}
      </span>
    </div>
  );
}

function ProjectParticipantAvatar({
  active,
  projectId
}: Readonly<{
  active: ActiveProjectParticipant;
  projectId: string;
}>) {
  const [failed, setFailed] = useState(false);
  const source = projectPresenceAvatarUrl(projectId, active.member);
  useEffect(() => setFailed(false), [source]);
  if (!source || failed) {
    return (
      <span
        aria-label={active.member.displayName}
        className="project-presence-avatar fallback"
        role="img"
      >
        {projectPresenceInitials(active.member.displayName)}
      </span>
    );
  }
  return (
    <img
      alt={active.member.displayName}
      className="project-presence-avatar"
      decoding="async"
      height={30}
      loading="eager"
      onError={() => setFailed(true)}
      src={source}
      width={30}
    />
  );
}

function participantTitle(
  active: ActiveProjectParticipant
): string {
  const status =
    active.participant.status === "AWAY" ? "неактивен" : "в сети";
  const editing = active.participant.editing ? ", редактирует" : "";
  const tabs =
    active.connectionCount > 1
      ? `, вкладок: ${active.connectionCount}`
      : "";
  return `${active.member.displayName} — ${projectPresenceRouteLabel(active.participant.route)}, ${status}${editing}${tabs}`;
}
