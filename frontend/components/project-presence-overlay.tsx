"use client";

import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from "react";
import { createPortal } from "react-dom";
import type { ActiveProjectParticipant } from "../lib/project-presence";
import { useProjectPresence } from "./project-presence-provider";

interface CursorVisual {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly editing: boolean;
  readonly colorIndex: number;
}

interface SelectionVisual {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  readonly colorIndex: number;
}

interface PresenceVisuals {
  readonly cursors: readonly CursorVisual[];
  readonly selections: readonly SelectionVisual[];
}

export function ProjectPresenceOverlay() {
  const pathname = usePathname();
  const { activeParticipants, currentUserId, projectId } =
    useProjectPresence();
  const [mounted, setMounted] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [visuals, setVisuals] = useState<PresenceVisuals>({
    cursors: [],
    selections: []
  });
  const remoteParticipants = useMemo(
    () =>
      activeParticipants.filter(
        (active) =>
          active.userId !== currentUserId &&
          active.participant.route === pathname &&
          active.participant.status === "ACTIVE"
      ),
    [activeParticipants, currentUserId, pathname]
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
      setVisuals({ cursors: [], selections: [] });
      return;
    }
    setVisuals(measurePresenceVisuals(remoteParticipants));
  }, [mounted, projectId, remoteParticipants, viewportVersion]);

  if (!mounted || !projectId || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden="true" className="project-presence-overlay">
      {visuals.selections.map((selection) => (
        <span
          className={`project-presence-selection presence-color-${selection.colorIndex}`}
          key={selection.key}
          style={{
            height: selection.height,
            left: selection.left,
            top: selection.top,
            width: selection.width
          }}
        >
          {selection.label && <b>{selection.label}</b>}
        </span>
      ))}
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
  const selections: SelectionVisual[] = [];
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
    const selection = active.participant.selection;
    if (!selection || selection.entity !== "KEYWORD") continue;
    const ids = [
      ...new Set([
        ...selection.highlightedIds,
        ...selection.selectedIds
      ])
    ].slice(0, 16);
    ids.forEach((id, index) => {
      const row = document.querySelector<HTMLElement>(
        `[data-presence-row-id="${id}"]`
      );
      if (!row) return;
      const rect = row.getBoundingClientRect();
      if (!visibleRect(rect)) return;
      selections.push({
        key: `${active.userId}:${id}`,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        ...(index === 0
          ? {
              label: `${active.member.displayName} · выделено ${ids.length}`
            }
          : {}),
        colorIndex: active.colorIndex
      });
    });
  }
  return { cursors, selections };
}

function cursorPoint(
  cursor: NonNullable<ActiveProjectParticipant["participant"]["cursor"]>
): { readonly x: number; readonly y: number } | undefined {
  if (cursor.targetKey && cursor.targetX !== null && cursor.targetY !== null) {
    const escaped = cssEscape(cursor.targetKey);
    const target = document.querySelector<HTMLElement>(
      `[data-presence-key="${escaped}"]`
    );
    if (target) {
      const rect = target.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width * cursor.targetX,
        y: rect.top + rect.height * cursor.targetY
      };
      if (visiblePoint(point.x, point.y)) return point;
    }
  }
  const point = {
    x: window.innerWidth * cursor.x,
    y: window.innerHeight * cursor.y
  };
  return visiblePoint(point.x, point.y) ? point : undefined;
}

function visiblePoint(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
}

function visibleRect(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= window.innerHeight &&
    rect.left <= window.innerWidth
  );
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replaceAll(":", "\\:");
}
