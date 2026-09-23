"use client";

import {
  projectPresenceCursorIntervalMilliseconds,
  projectPresenceHeartbeatMilliseconds,
  projectPresenceMaximumSelectionIds,
  projectPresenceMembers,
  projectPresenceParticipant,
  projectSemanticChangeEvent,
  projectPresenceTtlMilliseconds,
  realtimeCollaborationNamespace,
  realtimeCollaborationEvents,
  realtimeProjectTicket,
  type PresenceJoinResult,
  type ProjectPresenceCursor,
  type ProjectPresenceActivity,
  type ProjectPresenceLeftEvent,
  type ProjectPresenceMember,
  type ProjectPresenceParticipant,
  type ProjectPresenceSelection,
  type ProjectPresenceUpdateInput,
  type ProjectPresenceViewContext,
  type ProjectSemanticChangeInput,
  type RealtimeProjectTicket,
  type RealtimeReadyEvent
} from "@seo-platform/contracts";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { io, type Socket } from "socket.io-client";
import type { AppUser } from "../lib/app-types";
import { browserApiRequest } from "../lib/browser-api";
import {
  aggregateProjectParticipants,
  normalizeProjectPresenceView,
  sameProjectPresenceView,
  type ActiveProjectParticipant
} from "../lib/project-presence";
import { projectSemanticMutationEvent } from "../lib/semantic-realtime";

type ProjectPresenceConnectionStatus =
  | "DISABLED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED";

interface ProjectPresenceContextValue {
  readonly projectId?: string;
  readonly currentUserId: string;
  readonly currentRoute: string;
  readonly currentView: ProjectPresenceViewContext | null;
  readonly currentActivity: ProjectPresenceActivity | null;
  readonly connectionStatus: ProjectPresenceConnectionStatus;
  readonly participants: readonly ProjectPresenceParticipant[];
  readonly activeParticipants: readonly ActiveProjectParticipant[];
  readonly semanticChangeVersion: number;
  readonly showRemoteActivity: boolean;
  readonly setShowRemoteActivity: (visible: boolean) => void;
  readonly publishSelection: (
    selection: ProjectPresenceSelection | null
  ) => void;
  readonly publishView: (view: ProjectPresenceViewContext | null) => void;
  readonly publishActivity: (activity: ProjectPresenceActivity | null) => void;
}

const ProjectPresenceContext = createContext<ProjectPresenceContextValue | null>(
  null
);

export function ProjectPresenceProvider({
  children,
  projectId,
  user
}: Readonly<{
  children: ReactNode;
  projectId?: string;
  user: Pick<AppUser, "id" | "displayName" | "avatarUpdatedAt">;
}>) {
  const pathname = usePathname();
  const [connectionStatus, setConnectionStatus] =
    useState<ProjectPresenceConnectionStatus>(
      projectId ? "CONNECTING" : "DISABLED"
    );
  const [participants, setParticipants] = useState<
    readonly ProjectPresenceParticipant[]
  >([]);
  const [members, setMembers] = useState<
    ReadonlyMap<string, ProjectPresenceMember>
  >(() => new Map());
  const [currentView, setCurrentView] =
    useState<ProjectPresenceViewContext | null>(null);
  const [currentActivity, setCurrentActivity] =
    useState<ProjectPresenceActivity | null>(null);
  const [showRemoteActivity, setShowRemoteActivityState] = useState(false);
  const [semanticChangeVersion, setSemanticChangeVersion] = useState(0);
  const socketRef = useRef<PresenceSocket | undefined>(undefined);
  const joinedRef = useRef(false);
  const routeRef = useRef(normalizedAppRoute(pathname));
  const cursorRef = useRef<ProjectPresenceCursor | null>(null);
  const selectionRef = useRef<ProjectPresenceSelection | null>(null);
  const viewRef = useRef<ProjectPresenceViewContext | null>(null);
  const activityRef = useRef<ProjectPresenceActivity | null>(null);
  const statusRef = useRef<ProjectPresenceUpdateInput["status"]>("ACTIVE");
  const editingRef = useRef(false);
  const showRemoteActivityRef = useRef(false);
  const sequenceRef = useRef(0);
  const sendRef = useRef<() => void>(() => undefined);
  const semanticChangePendingRef = useRef(false);
  const sendSemanticChangeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleMutation = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        !plainRecord(event.detail) ||
        !hasExactKeys(event.detail, ["projectId"]) ||
        event.detail.projectId !== projectId
      ) {
        return;
      }
      semanticChangePendingRef.current = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        sendSemanticChangeRef.current();
      }, 120);
    };
    window.addEventListener(projectSemanticMutationEvent, handleMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(projectSemanticMutationEvent, handleMutation);
      semanticChangePendingRef.current = false;
    };
  }, [projectId]);

  useEffect(() => {
    setMembers(
      new Map([
        [
          user.id,
          {
            userId: user.id,
            displayName: user.displayName,
            ...(user.avatarUpdatedAt
              ? { avatarUpdatedAt: user.avatarUpdatedAt }
              : {})
          }
        ]
      ])
    );
  }, [projectId, user.avatarUpdatedAt, user.displayName, user.id]);

  useEffect(() => {
    const nextRoute = normalizedAppRoute(pathname);
    if (routeRef.current === nextRoute) return;
    routeRef.current = nextRoute;
    cursorRef.current = null;
    selectionRef.current = null;
    viewRef.current = null;
    setCurrentView(null);
    activityRef.current = null;
    setCurrentActivity(null);
    sendRef.current();
  }, [pathname]);

  useEffect(() => {
    if (!projectId) {
      showRemoteActivityRef.current = false;
      setShowRemoteActivityState(false);
      return;
    }
    try {
      const visible =
        window.localStorage.getItem(presenceVisibilityKey(projectId)) ===
        "visible";
      showRemoteActivityRef.current = visible;
      setShowRemoteActivityState(visible);
    } catch {
      showRemoteActivityRef.current = false;
      setShowRemoteActivityState(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      joinedRef.current = false;
      socketRef.current = undefined;
      setParticipants([]);
      setConnectionStatus("DISABLED");
      return;
    }

    let cancelled = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    let semanticRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let currentSocket: PresenceSocket | undefined;
    const pendingLeaves = new Map<
      string,
      ReturnType<typeof setTimeout>
    >();

    const clearConnectionTimers = () => {
      if (renewalTimer) clearTimeout(renewalTimer);
      if (joinTimer) clearTimeout(joinTimer);
      renewalTimer = undefined;
      joinTimer = undefined;
    };

    const closeSocket = () => {
      clearConnectionTimers();
      joinedRef.current = false;
      sendRef.current = () => undefined;
      sendSemanticChangeRef.current = () => undefined;
      if (currentSocket) {
        currentSocket.removeAllListeners();
        currentSocket.disconnect();
      }
      if (socketRef.current === currentSocket) {
        socketRef.current = undefined;
      }
      currentSocket = undefined;
    };

    const scheduleReconnect = (delay?: number) => {
      if (cancelled || retryTimer) return;
      closeSocket();
      setConnectionStatus("DEGRADED");
      const retryDelay =
        delay ?? Math.min(15_000, 750 * 2 ** Math.min(retryAttempt, 4));
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, retryDelay);
    };

    const loadMembers = async () => {
      try {
        const data = await browserApiRequest<unknown>(
          `/app/api/projects/${encodeURIComponent(
            projectId
          )}/presence-members`
        );
        if (cancelled) return;
        const parsed = projectPresenceMembers(data);
        setMembers(
          new Map([
            ...parsed.map((member) => [member.userId, member] as const),
            [
              user.id,
              {
                userId: user.id,
                displayName: user.displayName,
                ...(user.avatarUpdatedAt
                  ? { avatarUpdatedAt: user.avatarUpdatedAt }
                  : {})
              }
            ]
          ])
        );
      } catch {
        // Presence remains usable with safe initials if profile enrichment is
        // temporarily unavailable.
      }
    };

    const connect = async () => {
      if (cancelled) return;
      setConnectionStatus(retryAttempt === 0 ? "CONNECTING" : "DEGRADED");
      let ticket: RealtimeProjectTicket;
      const clientInstanceId = browserClientInstanceId();
      try {
        const value = await browserApiRequest<unknown>(
          `/app/api/projects/${encodeURIComponent(
            projectId
          )}/realtime-tickets`,
          {
            method: "POST",
            body: { clientInstanceId }
          }
        );
        ticket = realtimeProjectTicket(value);
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const socket: PresenceSocket = io(realtimeCollaborationNamespace, {
        path: "/socket.io",
        transports: ["websocket"],
        auth: { ticket: ticket.ticket },
        forceNew: true,
        reconnection: false,
        timeout: 8_000
      });
      currentSocket = socket;
      socketRef.current = socket;

      const failConnection = () => {
        if (currentSocket === socket) scheduleReconnect();
      };

      socket.on("connect_error", failConnection);
      socket.on("disconnect", failConnection);
      socket.on(realtimeCollaborationEvents.presenceJoined, (value) => {
        const participant = safeParticipantEvent(value);
        if (participant) upsertParticipant(setParticipants, participant);
      });
      socket.on(realtimeCollaborationEvents.presenceUpdated, (value) => {
        const participant = safeParticipantEvent(value);
        if (participant) upsertParticipant(setParticipants, participant);
      });
      socket.on(realtimeCollaborationEvents.presenceLeft, (value) => {
        const left = safeLeftEvent(value);
        if (!left) return;
        const existingTimer = pendingLeaves.get(left.connectionId);
        if (existingTimer) clearTimeout(existingTimer);
        pendingLeaves.set(
          left.connectionId,
          setTimeout(() => {
            pendingLeaves.delete(left.connectionId);
            setParticipants((current) =>
              current.filter(
                (participant) =>
                  participant.connectionId !== left.connectionId ||
                  participant.userId !== left.userId
              )
            );
          }, 2_500)
        );
      });
      socket.on(realtimeCollaborationEvents.semanticChanged, (value) => {
        const event = safeSemanticChangeEvent(value, projectId);
        if (!event) return;
        if (semanticRefreshTimer) clearTimeout(semanticRefreshTimer);
        semanticRefreshTimer = setTimeout(() => {
          semanticRefreshTimer = undefined;
          setSemanticChangeVersion((version) => version + 1);
        }, 120);
      });
      socket.once(realtimeCollaborationEvents.ready, (value) => {
        const ready = safeReadyEvent(value);
        if (
          !ready ||
          ready.connectionId !== socket.id ||
          ready.userId !== user.id ||
          ready.clientInstanceId !== clientInstanceId
        ) {
          failConnection();
          return;
        }
        joinTimer = setTimeout(failConnection, 5_000);
        socket.emit(realtimeCollaborationEvents.presenceJoin, {}, (result) => {
          if (joinTimer) clearTimeout(joinTimer);
          joinTimer = undefined;
          const joined = safeJoinResult(result, projectId, ready);
          if (!joined || currentSocket !== socket || cancelled) {
            failConnection();
            return;
          }
          joinedRef.current = true;
          retryAttempt = 0;
          setParticipants(joined.participants);
          setConnectionStatus("CONNECTED");
          sendRef.current = () => {
            if (
              !joinedRef.current ||
              currentSocket !== socket ||
              !socket.connected
            ) {
              return;
            }
            sequenceRef.current += 1;
            const update: ProjectPresenceUpdateInput = {
              route: routeRef.current,
              status: statusRef.current,
              cursor: showRemoteActivityRef.current
                ? cursorRef.current
                : null,
              selection: selectionRef.current,
              view: viewRef.current,
              activity: activityRef.current,
              editing: editingRef.current,
              sequence: sequenceRef.current
            };
            updateLocalParticipant(
              setParticipants,
              joined.participant,
              update
            );
            socket.emit(realtimeCollaborationEvents.presenceUpdate, update);
          };
          sendSemanticChangeRef.current = () => {
            if (
              !semanticChangePendingRef.current ||
              !joinedRef.current ||
              currentSocket !== socket ||
              !socket.connected
            ) {
              return;
            }
            semanticChangePendingRef.current = false;
            const change: ProjectSemanticChangeInput = {
              changeId: crypto.randomUUID()
            };
            socket.emit(realtimeCollaborationEvents.semanticChange, change);
          };
          sendRef.current();
          sendSemanticChangeRef.current();
          const renewalDelay = Math.max(
            1_000,
            Date.parse(joined.authorizationExpiresAt) - Date.now() - 10_000
          );
          renewalTimer = setTimeout(() => scheduleReconnect(0), renewalDelay);
        });
      });
    };

    void loadMembers();
    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      for (const timer of pendingLeaves.values()) clearTimeout(timer);
      pendingLeaves.clear();
      if (semanticRefreshTimer) clearTimeout(semanticRefreshTimer);
      closeSocket();
      setParticipants([]);
    };
  }, [projectId, user.avatarUpdatedAt, user.displayName, user.id]);

  useEffect(() => {
    if (!projectId) return;
    let pointerTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPointerSentAt = 0;
    let lastIdleResetAt = 0;

    const sendPointer = () => {
      pointerTimer = undefined;
      lastPointerSentAt = Date.now();
      sendRef.current();
    };
    const queuePointer = () => {
      if (pointerTimer) return;
      const delay = Math.max(
        0,
        projectPresenceCursorIntervalMilliseconds -
          (Date.now() - lastPointerSentAt)
      );
      pointerTimer = setTimeout(sendPointer, delay);
    };
    const markAway = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      statusRef.current = "AWAY";
      cursorRef.current = null;
      editingRef.current = false;
      sendRef.current();
    };
    const markActive = () => {
      const becameActive = statusRef.current !== "ACTIVE";
      statusRef.current = "ACTIVE";
      const now = Date.now();
      if (now - lastIdleResetAt > 1_000 || !idleTimer) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(markAway, 30_000);
        lastIdleResetAt = now;
      }
      if (becameActive) sendRef.current();
    };
    const handlePointerMove = (event: PointerEvent) => {
      markActive();
      cursorRef.current = pointerCursor(event);
      queuePointer();
    };
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      cursorRef.current = null;
      sendRef.current();
    };
    const handleScroll = () => markActive();
    const updateEditing = () => {
      const next = isEditableElement(document.activeElement);
      if (editingRef.current === next) return;
      editingRef.current = next;
      markActive();
      sendRef.current();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        markAway();
      } else {
        markActive();
      }
    };
    const heartbeat = setInterval(
      () => sendRef.current(),
      projectPresenceHeartbeatMilliseconds
    );

    if (document.visibilityState === "hidden") markAway();
    else markActive();
    if (showRemoteActivity) {
      document.addEventListener("pointermove", handlePointerMove, {
        passive: true
      });
      document.addEventListener("pointerdown", handlePointerMove, {
        passive: true
      });
      document.addEventListener("pointerout", handlePointerOut, {
        passive: true
      });
    } else {
      cursorRef.current = null;
      document.addEventListener("pointerdown", markActive, { passive: true });
    }
    document.addEventListener("wheel", handleScroll, { passive: true });
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true
    });
    document.addEventListener("keydown", markActive, { passive: true });
    document.addEventListener("focusin", updateEditing);
    document.addEventListener("focusout", updateEditing);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (pointerTimer) clearTimeout(pointerTimer);
      if (idleTimer) clearTimeout(idleTimer);
      clearInterval(heartbeat);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerMove);
      document.removeEventListener("pointerdown", markActive);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("wheel", handleScroll);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", markActive);
      document.removeEventListener("focusin", updateEditing);
      document.removeEventListener("focusout", updateEditing);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [projectId, showRemoteActivity]);

  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - projectPresenceTtlMilliseconds;
      setParticipants((current) => {
        const next = current.filter(
          (participant) =>
            participant.userId === user.id ||
            Date.parse(participant.updatedAt) > cutoff
        );
        return next.length === current.length ? current : next;
      });
    }, 5_000);
    return () => clearInterval(timer);
  }, [projectId, user.id]);

  const publishSelection = useCallback(
    (selection: ProjectPresenceSelection | null) => {
      selectionRef.current = selection
        ? {
            entity: selection.entity,
            selectedIds: uniqueIds(selection.selectedIds),
            highlightedIds: uniqueIds(selection.highlightedIds),
            columnId: selection.columnId
          }
        : null;
      sendRef.current();
    },
    []
  );

  const publishView = useCallback(
    (view: ProjectPresenceViewContext | null) => {
      const next = normalizeProjectPresenceView(
        view
          ? {
              kind: "SEMANTIC_CORE",
              groupIds: view.groupIds.filter((groupId) =>
                UUID_PATTERN.test(groupId)
              )
            }
          : null
      );
      if (sameProjectPresenceView(viewRef.current, next)) return;
      viewRef.current = next;
      setCurrentView(next);
      sendRef.current();
    },
    []
  );

  const publishActivity = useCallback(
    (activity: ProjectPresenceActivity | null) => {
      if (activityRef.current === activity) return;
      activityRef.current = activity;
      setCurrentActivity(activity);
      sendRef.current();
    },
    []
  );

  const setShowRemoteActivity = useCallback(
    (visible: boolean) => {
      showRemoteActivityRef.current = visible;
      if (!visible) cursorRef.current = null;
      setShowRemoteActivityState(visible);
      sendRef.current();
      if (!projectId) return;
      try {
        window.localStorage.setItem(
          presenceVisibilityKey(projectId),
          visible ? "visible" : "hidden"
        );
      } catch {
        // A blocked storage API must not disable collaboration for the tab.
      }
    },
    [projectId]
  );

  const activeParticipants = useMemo(
    () => aggregateProjectParticipants(participants, members, user.id),
    [members, participants, user.id]
  );
  const value = useMemo<ProjectPresenceContextValue>(
    () => ({
      ...(projectId ? { projectId } : {}),
      currentUserId: user.id,
      currentRoute: normalizedAppRoute(pathname),
      currentView,
      currentActivity,
      connectionStatus,
      participants,
      activeParticipants,
      semanticChangeVersion,
      showRemoteActivity,
      setShowRemoteActivity,
      publishSelection,
      publishView,
      publishActivity
    }),
    [
      activeParticipants,
      connectionStatus,
      currentActivity,
      currentView,
      participants,
      pathname,
      projectId,
      publishSelection,
      publishActivity,
      publishView,
      semanticChangeVersion,
      setShowRemoteActivity,
      showRemoteActivity,
      user.id
    ]
  );
  return (
    <ProjectPresenceContext.Provider value={value}>
      {children}
    </ProjectPresenceContext.Provider>
  );
}

export function useProjectPresence(): ProjectPresenceContextValue {
  const context = useContext(ProjectPresenceContext);
  if (!context) {
    throw new Error("Project presence must be used inside its provider");
  }
  return context;
}

interface ServerToClientEvents {
  readonly "realtime.ready": (event: unknown) => void;
  readonly "presence.joined": (event: unknown) => void;
  readonly "presence.updated": (event: unknown) => void;
  readonly "presence.left": (event: unknown) => void;
  readonly "semantics.changed": (event: unknown) => void;
}

interface ClientToServerEvents {
  readonly "presence.join": (
    message: Readonly<Record<string, never>>,
    acknowledge: (result: unknown) => void
  ) => void;
  readonly "presence.update": (message: ProjectPresenceUpdateInput) => void;
  readonly "semantics.change": (message: ProjectSemanticChangeInput) => void;
}

type PresenceSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function upsertParticipant(
  setParticipants: (
    update: (
      current: readonly ProjectPresenceParticipant[]
    ) => readonly ProjectPresenceParticipant[]
  ) => void,
  participant: ProjectPresenceParticipant
): void {
  setParticipants((current) => [
    ...current.filter(
      (candidate) => candidate.connectionId !== participant.connectionId
    ),
    participant
  ]);
}

function updateLocalParticipant(
  setParticipants: (
    update: (
      current: readonly ProjectPresenceParticipant[]
    ) => readonly ProjectPresenceParticipant[]
  ) => void,
  identity: ProjectPresenceParticipant,
  update: ProjectPresenceUpdateInput
): void {
  setParticipants((current) => {
    const existing = current.find(
      (participant) => participant.connectionId === identity.connectionId
    );
    if (
      existing &&
      existing.route === update.route &&
      existing.status === update.status &&
      existing.editing === update.editing &&
      existing.activity === update.activity &&
      existing.selection === update.selection &&
      existing.view === update.view
    ) {
      return current;
    }
    const participant: ProjectPresenceParticipant = {
      connectionId: identity.connectionId,
      userId: identity.userId,
      clientInstanceId: identity.clientInstanceId,
      ...update,
      updatedAt: new Date().toISOString()
    };
    return [
      ...current.filter(
        (candidate) => candidate.connectionId !== identity.connectionId
      ),
      participant
    ];
  });
}

function browserClientInstanceId(): string {
  const key = "seo-project-presence-client-instance";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && UUID_PATTERN.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    fallbackClientInstanceId ??= crypto.randomUUID();
    return fallbackClientInstanceId;
  }
}

function presenceVisibilityKey(projectId: string): string {
  return `seo-project-presence-visibility:v2:${projectId}`;
}

function normalizedAppRoute(pathname: string): string {
  return /^\/app(?:\/[A-Za-z0-9_-]{1,80}){0,8}$/u.test(pathname) &&
    pathname.length <= 256
    ? pathname
    : "/app";
}

function pointerCursor(event: PointerEvent): ProjectPresenceCursor | null {
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(
          '[data-presence-key][data-presence-cursor-anchor="true"]'
        )
      : null;
  const targetKey = anchor?.dataset.presenceKey;
  if (!targetKey || !PRESENCE_TARGET_KEY_PATTERN.test(targetKey)) {
    return viewportCursor(event.clientX, event.clientY);
  }
  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return viewportCursor(event.clientX, event.clientY);
  }
  return {
    x: unitCoordinate(event.clientX / Math.max(1, window.innerWidth)),
    y: unitCoordinate(event.clientY / Math.max(1, window.innerHeight)),
    targetKey,
    targetX: unitCoordinate((event.clientX - rect.left) / rect.width),
    targetY: unitCoordinate((event.clientY - rect.top) / rect.height)
  };
}

function viewportCursor(clientX: number, clientY: number): ProjectPresenceCursor {
  return {
    x: unitCoordinate(clientX / Math.max(1, window.innerWidth)),
    y: unitCoordinate(clientY / Math.max(1, window.innerHeight)),
    targetKey: null,
    targetX: null,
    targetY: null
  };
}

function unitCoordinate(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
}

function isEditableElement(value: Element | null): boolean {
  return (
    value instanceof HTMLInputElement ||
    value instanceof HTMLTextAreaElement ||
    value instanceof HTMLSelectElement ||
    (value instanceof HTMLElement && value.isContentEditable)
  );
}

function uniqueIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => UUID_PATTERN.test(value)))].slice(
    0,
    projectPresenceMaximumSelectionIds
  );
}

function safeJoinResult(
  value: unknown,
  projectId: string,
  ready: RealtimeReadyEvent
): Extract<PresenceJoinResult, { ok: true }>["data"] | undefined {
  if (
    !plainRecord(value) ||
    !hasExactKeys(value, ["ok", "data"]) ||
    value.ok !== true ||
    !plainRecord(value.data) ||
    !hasExactKeys(value.data, [
      "connectionId",
      "projectId",
      "authorizationExpiresAt",
      "participant",
      "participants"
    ])
  ) {
    return undefined;
  }
  const data = value.data;
  if (
    data.projectId !== projectId ||
    data.connectionId !== ready.connectionId ||
    !CONNECTION_ID_PATTERN.test(data.connectionId) ||
    typeof data.authorizationExpiresAt !== "string" ||
    !validIsoTimestamp(data.authorizationExpiresAt) ||
    data.authorizationExpiresAt !== ready.authorizationExpiresAt ||
    !Array.isArray(data.participants) ||
    data.participants.length > 500
  ) {
    return undefined;
  }
  const participant = safeParticipant(data.participant);
  const participants = data.participants.map(safeParticipant);
  const parsedParticipants = participants.filter(
    (candidate): candidate is ProjectPresenceParticipant => Boolean(candidate)
  );
  if (
    !participant ||
    parsedParticipants.length !== participants.length ||
    participant.connectionId !== ready.connectionId ||
    participant.userId !== ready.userId ||
    participant.clientInstanceId !== ready.clientInstanceId ||
    new Set(parsedParticipants.map((candidate) => candidate.connectionId))
      .size !== parsedParticipants.length ||
    !parsedParticipants.some(
      (candidate) => candidate.connectionId === ready.connectionId
    )
  ) {
    return undefined;
  }
  return {
    connectionId: data.connectionId,
    projectId,
    authorizationExpiresAt: data.authorizationExpiresAt,
    participant,
    participants: parsedParticipants
  };
}

function safeParticipantEvent(
  value: unknown
): ProjectPresenceParticipant | undefined {
  if (!plainRecord(value) || !hasExactKeys(value, ["participant"])) {
    return undefined;
  }
  return safeParticipant(value.participant);
}

function safeSemanticChangeEvent(
  value: unknown,
  projectId: string
): ReturnType<typeof projectSemanticChangeEvent> | undefined {
  try {
    const event = projectSemanticChangeEvent(value);
    return event.projectId === projectId ? event : undefined;
  } catch {
    return undefined;
  }
}

function safeParticipant(
  value: unknown
): ProjectPresenceParticipant | undefined {
  try {
    return projectPresenceParticipant(value);
  } catch {
    return undefined;
  }
}

function safeLeftEvent(value: unknown): ProjectPresenceLeftEvent | undefined {
  if (
    !plainRecord(value) ||
    !hasExactKeys(value, ["connectionId", "userId", "occurredAt"]) ||
    typeof value.connectionId !== "string" ||
    !CONNECTION_ID_PATTERN.test(value.connectionId) ||
    !UUID_PATTERN.test(String(value.userId)) ||
    typeof value.occurredAt !== "string" ||
    !validIsoTimestamp(value.occurredAt)
  ) {
    return undefined;
  }
  return {
    connectionId: value.connectionId,
    userId: String(value.userId),
    occurredAt: value.occurredAt
  };
}

function safeReadyEvent(value: unknown): RealtimeReadyEvent | undefined {
  if (
    !plainRecord(value) ||
    !hasExactKeys(value, [
      "connectionId",
      "userId",
      "sessionId",
      "clientInstanceId",
      "authorizationExpiresAt"
    ]) ||
    typeof value.connectionId !== "string" ||
    !CONNECTION_ID_PATTERN.test(value.connectionId) ||
    !UUID_PATTERN.test(String(value.userId)) ||
    !UUID_PATTERN.test(String(value.sessionId)) ||
    !UUID_PATTERN.test(String(value.clientInstanceId)) ||
    typeof value.authorizationExpiresAt !== "string" ||
    !validIsoTimestamp(value.authorizationExpiresAt)
  ) {
    return undefined;
  }
  return {
    connectionId: value.connectionId,
    userId: String(value.userId),
    sessionId: String(value.sessionId),
    clientInstanceId: String(value.clientInstanceId),
    authorizationExpiresAt: value.authorizationExpiresAt
  };
}

function validIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => keys.includes(key))
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const PRESENCE_TARGET_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,180}$/u;
let fallbackClientInstanceId: string | undefined;
