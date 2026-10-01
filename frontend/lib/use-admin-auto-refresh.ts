"use client";

import { useEffect, useRef } from "react";

/** One non-overlapping refresh per visible screen; editing forms keeps its own state. */
export function useAdminAutoRefresh(refresh: () => Promise<unknown>, enabled = true): void {
  const current = useRef(refresh);
  useEffect(() => { current.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const timer = window.setInterval(() => {
      if (running || document.hidden) return;
      running = true;
      void current.current().finally(() => { running = false; });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
