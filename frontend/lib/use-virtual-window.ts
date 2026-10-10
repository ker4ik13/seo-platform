"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { virtualWindow } from "./virtual-window";

export function useVirtualWindow(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  headerHeight = 0,
  threshold = 500
) {
  const [viewport, setViewport] = useState({ height: 600, scrollTop: 0 });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setViewport(current => current.height === element.clientHeight && current.scrollTop === element.scrollTop
        ? current : { height: element.clientHeight, scrollTop: element.scrollTop });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", schedule);
    };
  }, [scrollRef, count, rowHeight]);
  return virtualWindow(count, viewport, rowHeight, headerHeight, 12, threshold);
}
