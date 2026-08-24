import {
  projectPresenceMaximumViewGroupIds,
  type ProjectPresenceMember,
  type ProjectPresenceParticipant,
  type ProjectPresenceViewContext
} from "@seo-platform/contracts";

/*
 * The semantic workspace itself may open an unlimited folder union, while
 * realtime presence intentionally publishes only a bounded hint. Keeping the
 * projection canonical prevents a caller with more folders than the wire
 * contract allows from repeatedly publishing an equivalent truncated view.
 */
export function normalizeProjectPresenceView(
  view: ProjectPresenceViewContext | null
): ProjectPresenceViewContext | null {
  if (view === null) return null;
  return {
    kind: "SEMANTIC_CORE",
    groupIds: [...new Set(view.groupIds)]
      .sort()
      .slice(0, projectPresenceMaximumViewGroupIds)
  };
}

export interface ActiveProjectParticipant {
  readonly userId: string;
  readonly member: ProjectPresenceMember;
  readonly participant: ProjectPresenceParticipant;
  readonly connectionCount: number;
  readonly colorIndex: number;
}

export function aggregateProjectParticipants(
  participants: readonly ProjectPresenceParticipant[],
  members: ReadonlyMap<string, ProjectPresenceMember>,
  currentUserId: string
): readonly ActiveProjectParticipant[] {
  const byUser = new Map<
    string,
    { participant: ProjectPresenceParticipant; connectionCount: number }
  >();
  for (const participant of participants) {
    const current = byUser.get(participant.userId);
    if (!current) {
      byUser.set(participant.userId, {
        participant,
        connectionCount: 1
      });
      continue;
    }
    byUser.set(participant.userId, {
      participant: representativeParticipant(
        current.participant,
        participant
      ),
      connectionCount: current.connectionCount + 1
    });
  }
  return [...byUser.entries()]
    .map(([userId, state]) => ({
      userId,
      member: members.get(userId) ?? {
        userId,
        displayName: "Участник проекта"
      },
      participant: state.participant,
      connectionCount: state.connectionCount,
      colorIndex: stablePresenceColorIndex(userId)
    }))
    .sort((left, right) => {
      if (left.userId === currentUserId) return -1;
      if (right.userId === currentUserId) return 1;
      if (left.participant.status !== right.participant.status) {
        return left.participant.status === "ACTIVE" ? -1 : 1;
      }
      return left.member.displayName.localeCompare(
        right.member.displayName,
        "ru"
      );
    });
}

function representativeParticipant(
  current: ProjectPresenceParticipant,
  candidate: ProjectPresenceParticipant
): ProjectPresenceParticipant {
  if (current.status !== candidate.status) {
    return candidate.status === "ACTIVE" ? candidate : current;
  }
  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)
    ? candidate
    : current;
}

export function stablePresenceColorIndex(userId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 8;
}

export function sameProjectPresenceView(
  left: ProjectPresenceViewContext | null,
  right: ProjectPresenceViewContext | null
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.kind === right.kind &&
    left.groupIds.length === right.groupIds.length &&
    left.groupIds.every((groupId) => right.groupIds.includes(groupId))
  );
}

export function projectPresenceRouteLabel(route: string): string {
  const segments = route.split("/").filter(Boolean);
  if (segments.includes("semantics")) return "Семантика";
  if (segments.includes("pages")) return "Карта страниц";
  if (segments.includes("notes")) return "Заметки";
  if (segments.includes("tasks")) return "Операции";
  if (segments.includes("tools")) return "Инструменты";
  if (segments.includes("settings")) return "Настройки";
  if (segments.includes("projects")) return "Проект";
  return "Обзор проекта";
}

export function projectPresenceAvatarUrl(
  projectId: string,
  member: ProjectPresenceMember
): string | undefined {
  if (!member.avatarUpdatedAt) return undefined;
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/presence-members/${encodeURIComponent(
    member.userId
  )}/avatar?v=${encodeURIComponent(member.avatarUpdatedAt)}`;
}

export function projectPresenceInitials(displayName: string): string {
  return (
    displayName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru"))
      .join("") || "?"
  );
}
