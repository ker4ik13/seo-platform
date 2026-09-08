"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkspaceUsageSummary } from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import { canViewWorkspaceBilling } from "../lib/app-permissions";
import type { AppWorkspace } from "../lib/app-types";

interface UsageState { readonly data?: WorkspaceUsageSummary; readonly loading: boolean; readonly unavailable: boolean; readonly refresh: () => void }
const UsageContext = createContext<UsageState>({ loading: false, unavailable: false, refresh: () => {} });
export const useWorkspaceUsage = (): UsageState => useContext(UsageContext);

export function WorkspaceUsageProvider({ workspace, children }: Readonly<{ workspace?: AppWorkspace | undefined; children: ReactNode }>) {
  const [data, setData] = useState<WorkspaceUsageSummary>();
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const lastRead = useRef(0);
  const pendingRead = useRef(false);
  const deferred = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const workspaceId = workspace?.id;
  const allowed = canViewWorkspaceBilling(workspace?.roleCode);
  const refresh = useCallback(function refreshUsage() {
    if (!workspaceId || !allowed || document.visibilityState === "hidden") return;
    if (inFlight.current) { pendingRead.current = true; return; }
    const remainingDelay = 2_000 - (Date.now() - lastRead.current);
    if (remainingDelay > 0) { clearTimeout(deferred.current); deferred.current = setTimeout(refreshUsage, remainingDelay); return; }
    pendingRead.current = false;
    lastRead.current = Date.now();
    const controller = new AbortController();
    inFlight.current = controller;
    void browserApiRequest<WorkspaceUsageSummary>(`/app/api/workspaces/${encodeURIComponent(workspaceId)}/billing/usage`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.workspaceId !== workspaceId) throw new Error("Usage scope mismatch");
        setData(result); setUnavailable(false);
      })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = undefined;
        if (controller.signal.aborted) return;
        setLoading(false);
        if (pendingRead.current) { pendingRead.current = false; clearTimeout(deferred.current); deferred.current = setTimeout(refreshUsage, Math.max(0, 2_000 - (Date.now() - lastRead.current))); }
      });
  }, [workspaceId, allowed]);
  useEffect(() => {
    inFlight.current?.abort(); inFlight.current = undefined; lastRead.current = 0; pendingRead.current = false; clearTimeout(deferred.current);
    setData(undefined); setLoading(Boolean(workspaceId && allowed)); setUnavailable(false);
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("workspace-usage:refresh", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); clearTimeout(deferred.current); inFlight.current?.abort(); window.removeEventListener("workspace-usage:refresh", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refresh, workspaceId, allowed]);
  const scoped = data?.workspaceId === workspaceId ? data : undefined;
  return <UsageContext.Provider value={{ ...(scoped ? { data: scoped } : {}), loading, unavailable, refresh }}>{children}</UsageContext.Provider>;
}
