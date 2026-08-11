"use client";

import type { AppProject } from "../lib/app-types";
import { CustomSelect } from "./custom-select";
import { ProjectSelectOption } from "./project-select-option";

type ProjectDestination = "notes" | "pages" | "tasks";

export function ProjectContextSelect({
  destination,
  projectId,
  projects
}: Readonly<{
  destination: ProjectDestination;
  projectId: string;
  projects: readonly AppProject[];
}>) {
  function selectProject(nextProjectId: string): void {
    if (!nextProjectId || nextProjectId === projectId) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `seo_project=${encodeURIComponent(nextProjectId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.location.assign(destinationPath(destination, nextProjectId));
  }

  return (
    <CustomSelect
      aria-label="Выбрать проект"
      className="project-context-select"
      onChange={(event) => selectProject(event.currentTarget.value)}
      searchable={projects.length > 8}
      showSelectedCheck={false}
      value={projectId}
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          <ProjectSelectOption project={project} />
        </option>
      ))}
    </CustomSelect>
  );
}

function destinationPath(
  destination: ProjectDestination,
  projectId: string
): string {
  if (destination === "tasks") return "/app/tasks";
  return `/app/projects/${encodeURIComponent(projectId)}/${destination}`;
}
