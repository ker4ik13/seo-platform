"use client";

import type { AppProject } from "../lib/app-types";
import { ProjectSelect } from "./project-select";

type ProjectDestination = "notes" | "pages" | "tasks";

export function ProjectContextSelect({
  destination,
  canReorder,
  projectId,
  projects,
  workspaceId
}: Readonly<{
  destination: ProjectDestination;
  canReorder: boolean;
  projectId: string;
  projects: readonly AppProject[];
  workspaceId: string;
}>) {
  function selectProject(nextProjectId: string): void {
    if (!nextProjectId || nextProjectId === projectId) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `seo_project=${encodeURIComponent(nextProjectId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.location.assign(destinationPath(destination, nextProjectId));
  }

  return (
    <ProjectSelect
      ariaLabel="Выбрать проект"
      canReorder={canReorder}
      className="project-context-select"
      onChange={selectProject}
      projects={projects}
      value={projectId}
      workspaceId={workspaceId}
    />
  );
}

function destinationPath(
  destination: ProjectDestination,
  projectId: string
): string {
  if (destination === "tasks") return "/app/tasks";
  return `/app/projects/${encodeURIComponent(projectId)}/${destination}`;
}
