"use client";

import { useEffect, useRef } from "react";

/** Refresh the mounted admin screen while its tab is open, including background tabs. */
export function useAdminAutoRefresh(refresh: () => Promise<unknown>, enabled = true): void {
  const current = useRef(refresh);
  useEffect(() => { current.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const refreshNow = () => {
      if (running) return;
      running = true;
      void current.current().finally(() => { running = false; });
    };
    const onVisibilityChange = () => { if (!document.hidden) refreshNow(); };
    const timer = window.setInterval(refreshNow, 1_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);
}
