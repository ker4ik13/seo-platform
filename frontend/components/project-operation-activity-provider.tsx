"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type {
  ProjectOperationActivityCollection,
  ProjectSummary
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";

const PROJECT_ACTIVITY_REFRESH_EVENT = "seo:project-operation-activity-refresh";
const ProjectOperationActivityContext = createContext<
  ReadonlyMap<string, number> | undefined
>(undefined);

export function ProjectOperationActivityProvider({
  children,
  projects,
  workspaceId
}: Readonly<{
  children: ReactNode;
  projects: readonly Pick<ProjectSummary, "id" | "activeOperationCount">[];
  workspaceId?: string;
}>) {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(
    () => initialCounts(projects)
  );

  useEffect(() => {
    setCounts(initialCounts(projects));
  }, [projects, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let inFlight = false;
    let active = projects.some(
      ({ activeOperationCount }) => (activeOperationCount ?? 0) > 0
    );

    const schedule = (): void => {
      if (controller.signal.aborted) return;
      timer = window.setTimeout(
        () => void refresh(),
        document.visibilityState === "visible"
          ? active
            ? 2_000
            : 7_500
          : 30_000
      );
    };
    const refresh = async (): Promise<void> => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const result = await browserApiRequest<ProjectOperationActivityCollection>(
          `/app/api/workspaces/${encodeURIComponent(workspaceId)}/operation-activity`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        const next = normalizedCounts(projects, result);
        active = [...next.values()].some((count) => count > 0);
        setCounts(next);
      } catch {
        // Keep the last authoritative projection during a temporary outage.
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const refreshNow = (): void => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      void refresh();
    };

    void refresh();
    window.addEventListener(PROJECT_ACTIVITY_REFRESH_EVENT, refreshNow);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(PROJECT_ACTIVITY_REFRESH_EVENT, refreshNow);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [projects, workspaceId]);

  const value = useMemo(() => counts, [counts]);
  return (
    <ProjectOperationActivityContext.Provider value={value}>
      {children}
    </ProjectOperationActivityContext.Provider>
  );
}

export function useProjectActiveOperationCount(
  projectId: string,
  fallback = 0
): number {
  const counts = useContext(ProjectOperationActivityContext);
  return counts?.get(projectId) ?? fallback;
}

export function requestProjectOperationActivityRefresh(): void {
  window.dispatchEvent(new Event(PROJECT_ACTIVITY_REFRESH_EVENT));
}

function initialCounts(
  projects: readonly Pick<ProjectSummary, "id" | "activeOperationCount">[]
): ReadonlyMap<string, number> {
  return new Map(
    projects.map((project) => [project.id, project.activeOperationCount ?? 0])
  );
}

function normalizedCounts(
  projects: readonly Pick<ProjectSummary, "id">[],
  result: ProjectOperationActivityCollection
): ReadonlyMap<string, number> {
  const next = new Map(projects.map(({ id }) => [id, 0]));
  for (const activity of result.projects) {
    if (
      next.has(activity.projectId) &&
      Number.isSafeInteger(activity.activeOperationCount) &&
      activity.activeOperationCount > 0
    ) {
      next.set(activity.projectId, activity.activeOperationCount);
    }
  }
  return next;
}
