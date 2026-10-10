import type { AnalyticsEventKind } from "@seo-platform/contracts";
let documentLcpReported = false;

/** Bounded native observations. Interaction timing is a distribution, not an INP claim. */
export function observeAnalyticsPerformance(
  emit: (kind: AnalyticsEventKind, value: number) => void,
  engaged: () => boolean,
) {
  const observers: PerformanceObserver[] = [],
    interactions = new Map<number, number>(),
    reportedInteractions = new Set<number>();
  let lcp: number | undefined,
    clsStart = 0,
    clsLast = 0,
    clsWindow = 0,
    clsMaximum = 0;
  if (typeof PerformanceObserver !== "undefined")
    for (const type of ["largest-contentful-paint", "layout-shift", "event"]) {
      if (type === "largest-contentful-paint" && documentLcpReported) continue;
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint") {
            if (engaged()) lcp = Math.min(60_000, entry.startTime);
          } else if (type === "layout-shift") {
            const shift = entry as PerformanceEntry & {
              hadRecentInput?: boolean;
              value: number;
            };
            if (shift.hadRecentInput || !engaged()) continue;
            if (
              entry.startTime - clsLast > 1000 ||
              entry.startTime - clsStart > 5000
            ) {
              clsStart = entry.startTime;
              clsWindow = 0;
            }
            clsLast = entry.startTime;
            clsWindow += shift.value;
            clsMaximum = Math.max(clsMaximum, clsWindow);
          } else {
            const interaction = entry as PerformanceEntry & {
              interactionId?: number;
            };
            if (
              interaction.interactionId &&
              engaged() &&
              !reportedInteractions.has(interaction.interactionId)
            ) {
              if (interactions.size >= 128)
                interactions.delete(interactions.keys().next().value!);
              interactions.set(
                interaction.interactionId,
                Math.max(
                  interactions.get(interaction.interactionId) ?? 0,
                  entry.duration,
                ),
              );
            }
          }
        }
      });
      try {
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        observer.disconnect();
      }
    }
  const flush = () => {
    if (lcp !== undefined && !documentLcpReported) {
      emit("LCP", lcp);
      documentLcpReported = true;
    }
    for (const [id, value] of interactions) {
      emit("INTERACTION", Math.min(value, 60_000));
      reportedInteractions.add(id);
    }
    interactions.clear();
    while (reportedInteractions.size > 128)
      reportedInteractions.delete(reportedInteractions.values().next().value!);
  };
  return {
    flush,
    stop: () => {
      for (const observer of observers) observer.disconnect();
      flush();
      if (clsMaximum > 0) emit("CLS", Math.round(clsMaximum * 1000));
    },
  };
}
