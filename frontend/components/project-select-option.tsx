"use client";

import type { AppProject } from "../lib/app-types";
import { ProjectFavicon } from "./project-favicon";
import { useProjectActiveOperationCount } from "./project-operation-activity-provider";

export function ProjectSelectOption({
  activeOperationCount,
  project
}: Readonly<{
  activeOperationCount?: number;
  project: Pick<AppProject, "id" | "name" | "version" | "activeOperationCount">;
}>) {
  const operationCount = useProjectActiveOperationCount(
    project.id,
    activeOperationCount ?? project.activeOperationCount ?? 0
  );
  return (
    <span className="project-select-option">
      <span aria-hidden="true" className="project-select-favicon-slot">
        <ProjectFavicon
          className="project-select-favicon"
          project={project}
        />
      </span>
      <strong title={project.name}>{project.name}</strong>
      {operationCount > 0 && (
        <span
          aria-label={`Активных операций: ${operationCount}`}
          className="project-active-operation-count"
          title={`Активных операций: ${operationCount}`}
        >
          <span aria-hidden="true" className="project-active-operation-spinner" />
          {operationCount}
        </span>
      )}
    </span>
  );
}
