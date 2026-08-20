"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  sameProjectPresenceView,
  type ActiveProjectParticipant
} from "../lib/project-presence";
import { useProjectPresence } from "./project-presence-provider";

interface CursorVisual {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly editing: boolean;
  readonly colorIndex: number;
}

interface PresenceVisuals {
  readonly cursors: readonly CursorVisual[];
}

export function ProjectPresenceOverlay() {
  const {
    activeParticipants,
    currentRoute,
    currentUserId,
    currentView,
    projectId
  } = useProjectPresence();
  const [mounted, setMounted] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [visuals, setVisuals] = useState<PresenceVisuals>({
    cursors: []
  });
  const remoteParticipants = useMemo(
    () =>
      activeParticipants.filter(
        (active) =>
          active.userId !== currentUserId &&
          active.participant.route === currentRoute &&
          sameProjectPresenceView(active.participant.view, currentView) &&
          active.participant.status === "ACTIVE"
      ),
    [activeParticipants, currentRoute, currentUserId, currentView]
  );

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    let frame: number | undefined;
    const refresh = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setViewportVersion((version) => version + 1);
      });
    };
    const root = document.querySelector(".main-column");
    const observer = root ? new MutationObserver(refresh) : undefined;
    const resizeObserver =
      root && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(refresh)
        : undefined;
    if (root && observer) {
      observer.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["class", "style"]
      });
    }
    if (root && resizeObserver) resizeObserver.observe(root);
    window.addEventListener("resize", refresh, { passive: true });
    document.addEventListener("scroll", refresh, {
      capture: true,
      passive: true
    });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refresh);
      document.removeEventListener("scroll", refresh, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!mounted || !projectId) {
      setVisuals({ cursors: [] });
      return;
    }
    setVisuals(measurePresenceVisuals(remoteParticipants));
  }, [mounted, projectId, remoteParticipants, viewportVersion]);

  if (!mounted || !projectId || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden="true" className="project-presence-overlay">
      {visuals.cursors.map((cursor) => (
        <span
          className={`project-presence-cursor presence-color-${cursor.colorIndex}`}
          key={cursor.key}
          style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }}
        >
          <svg viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 1.7v20.1l5.7-5.1 4.2 8.7 4.1-2-4.2-8.5 7.6-.8L2 1.7Z" />
          </svg>
          <b>
            {cursor.name}
            {cursor.editing ? " · редактирует" : ""}
          </b>
        </span>
      ))}
    </div>,
    document.body
  );
}

function measurePresenceVisuals(
  participants: readonly ActiveProjectParticipant[]
): PresenceVisuals {
  const cursors: CursorVisual[] = [];
  for (const active of participants) {
    const cursor = active.participant.cursor;
    if (cursor) {
      const point = cursorPoint(cursor);
      if (point) {
        cursors.push({
          key: active.participant.connectionId,
          x: point.x,
          y: point.y,
          name: active.member.displayName,
          editing: active.participant.editing,
          colorIndex: active.colorIndex
        });
      }
    }
  }
  return { cursors };
}

function cursorPoint(
  cursor: NonNullable<ActiveProjectParticipant["participant"]["cursor"]>
): { readonly x: number; readonly y: number } | undefined {
  if (cursor.targetKey && cursor.targetX !== null && cursor.targetY !== null) {
    const escaped = cssEscape(cursor.targetKey);
    const target = document.querySelector<HTMLElement>(
      `[data-presence-key="${escaped}"]`
    );
    if (target?.dataset.presenceCursorAnchor === "true") {
      const rect = target.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width * cursor.targetX,
        y: rect.top + rect.height * cursor.targetY
      };
      if (visibleTargetPoint(target, point.x, point.y)) return point;
    }
  }
  return undefined;
}

function visibleTargetPoint(target: HTMLElement, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return false;
  }
  const visibleElement = document.elementFromPoint(x, y);
  return visibleElement !== null && target.contains(visibleElement);
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replaceAll(":", "\\:");
}
