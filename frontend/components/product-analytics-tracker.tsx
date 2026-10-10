"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type {
  AnalyticsActivityBatch,
  AnalyticsEvent,
  AnalyticsInterval,
  AnalyticsEventKind,
  AnalyticsSection,
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import {
  analyticsBrowserEvent,
  analyticsLatencyBin,
  analyticsSection,
  isAnalyticsEngaged,
  type BrowserAnalyticsMetric,
} from "../lib/product-analytics";
import { observeAnalyticsPerformance } from "../lib/product-analytics-performance";

function usageSession(userId: string): string {
  const key = `seo:usage-session:${userId}`,
    now = Date.now();
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as {
      id?: unknown;
      at?: unknown;
    } | null;
    const id =
      typeof stored?.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        stored.id,
      ) &&
      typeof stored.at === "number" &&
      now - stored.at >= 0 &&
      now - stored.at < 1_800_000
        ? stored.id
        : crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
interface AnalyticsSenderState {
  pending: { userId: string; batch: AnalyticsActivityBatch; attempt: number }[];
  activeUserId: string | undefined;
  sending: boolean;
}
async function sendPending(state: AnalyticsSenderState): Promise<void> {
  if (state.sending) return;
  state.sending = true;
  try {
    while (state.pending.length) {
      const item = state.pending.shift()!;
      if (item.userId !== state.activeUserId) continue;
      try {
        await browserApiRequest<{ accepted: number }>(
          "/app/api/analytics/activity",
          {
            method: "POST",
            body: item.batch,
            signal: AbortSignal.timeout(5000),
          },
        );
      } catch {
        item.attempt++;
        if (item.attempt < 3 && item.userId === state.activeUserId) {
          state.pending.unshift(item);
          setTimeout(() => void sendPending(state), item.attempt * 10_000);
          break;
        }
      }
    }
  } finally {
    state.sending = false;
  }
}
function queueBatch(
  state: AnalyticsSenderState,
  userId: string,
  batch: AnalyticsActivityBatch,
  keepalive = false,
): void {
  if (userId !== state.activeUserId) return;
  if (keepalive) {
    const cookieName =
      process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME ?? "seo_csrf";
    const cookie = document.cookie
      .split(";")
      .map((row) => row.trim())
      .find((row) => row.startsWith(`${cookieName}=`));
    const csrf = cookie
      ? decodeURIComponent(cookie.slice(cookieName.length + 1))
      : undefined;
    void fetch("/app/api/analytics/activity", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(batch),
    }).catch(() => undefined);
    return;
  }
  if (state.pending.length >= 8) state.pending.shift();
  state.pending.push({ userId, batch, attempt: 0 });
  void sendPending(state);
}

export function ProductAnalyticsTracker({
  userId,
  workspaceId,
  projectId,
}: Readonly<{ userId: string; workspaceId?: string; projectId?: string }>) {
  const pathname = usePathname();
  const sender = useRef<AnalyticsSenderState>({
    pending: [],
    activeUserId: undefined,
    sending: false,
  });
  useEffect(() => {
    const state = sender.current;
    state.activeUserId = userId;
    return () => {
      if (state.activeUserId === userId) state.activeUserId = undefined;
      for (let index = state.pending.length - 1; index >= 0; index--)
        if (state.pending[index]?.userId === userId)
          state.pending.splice(index, 1);
    };
  }, [userId]);
  useEffect(() => {
    const section = analyticsSection(pathname ?? "/app");
    let lastInput = Date.now(),
      lastTick = Date.now(),
      wasEngaged = !document.hidden && document.hasFocus();
    let intervals: AnalyticsInterval[] = [];
    const events = new Map<string, AnalyticsEvent>();
    const add = (
      kind: AnalyticsEventKind,
      value = 0,
      target: AnalyticsSection = section,
    ) => {
      const key = `${target}:${kind}`,
        old = events.get(key);
      if (events.size >= 32 && !old) return;
      const histogram =
        kind === "API_TIMING" || kind === "INTERACTION"
          ? old?.histogram
            ? [...old.histogram]
            : Array<number>(11).fill(0)
          : undefined;
      if (histogram) {
        const bin = analyticsLatencyBin(value);
        histogram[bin] = (histogram[bin] ?? 0) + 1;
      }
      if ((old?.count ?? 0) >= 1000) return;
      events.set(key, {
        id: old?.id ?? crypto.randomUUID(),
        occurredAt: old?.occurredAt ?? new Date().toISOString(),
        section: target,
        kind,
        count: (old?.count ?? 0) + 1,
        value: (old?.value ?? 0) + Math.max(0, Math.round(value)),
        ...(histogram ? { histogram } : {}),
      });
    };
    const engaged = () =>
      isAnalyticsEngaged(
        !document.hidden,
        document.hasFocus(),
        lastInput,
        Date.now(),
      );
    const tick = () => {
      const now = Date.now(),
        active = engaged();
      if (active && wasEngaged && now - lastTick <= 10_000) {
        const previous = intervals.at(-1),
          duration = now - lastTick;
        if (
          previous &&
          Date.parse(previous.startedAt) + previous.durationMs === lastTick &&
          previous.durationMs + duration <= 60_000
        ) {
          intervals[intervals.length - 1] = {
            ...previous,
            durationMs: previous.durationMs + duration,
          };
        } else if (intervals.length < 32 && duration > 0)
          intervals.push({
            id: crypto.randomUUID(),
            startedAt: new Date(lastTick).toISOString(),
            durationMs: duration,
            section,
          });
      }
      lastTick = now;
      wasEngaged = active;
    };
    const performanceTracking = observeAnalyticsPerformance(
      (kind, value) => add(kind, value),
      engaged,
    );
    const flush = (keepalive = false) => {
      tick();
      performanceTracking.flush();
      if (intervals.length + events.size === 0) return;
      const batch: AnalyticsActivityBatch = {
        version: 1,
        sessionId: usageSession(userId),
        ...(workspaceId ? { workspaceId } : {}),
        ...(projectId ? { projectId } : {}),
        intervals,
        events: [...events.values()],
      };
      intervals = [];
      events.clear();
      queueBatch(sender.current, userId, batch, keepalive);
    };
    const pageHide = () => flush(true);
    const input = () => {
      const now = Date.now();
      if (now - lastInput > 1000) lastInput = now;
    };
    const visibility = () => {
      tick();
      if (document.hidden) flush();
      else {
        lastInput = Date.now();
        wasEngaged = document.hasFocus();
      }
    };
    const metric = (event: Event) => {
      if (!engaged()) return;
      const { kind, value, section } = (
        event as CustomEvent<BrowserAnalyticsMetric>
      ).detail;
      add(kind, value, section);
    };
    const error = () => {
      if (engaged()) add("CLIENT_ERROR");
    };
    if (!document.hidden) add("PAGE_VIEW");
    for (const name of [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
    ])
      document.addEventListener(name, input, { passive: true, capture: true });
    window.addEventListener(analyticsBrowserEvent, metric);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", error);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("blur", tick);
    window.addEventListener("focus", input);
    const tickTimer = setInterval(tick, 5000),
      flushTimer = setInterval(flush, 60_000);
    return () => {
      performanceTracking.stop();
      flush();
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      for (const name of [
        "pointermove",
        "pointerdown",
        "keydown",
        "wheel",
        "scroll",
      ])
        document.removeEventListener(name, input, true);
      window.removeEventListener(analyticsBrowserEvent, metric);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", error);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("blur", tick);
      window.removeEventListener("focus", input);
    };
  }, [pathname, userId, workspaceId, projectId]);
  return null;
}
