"use client";

import type { AppProject } from "../lib/app-types";
import { ProjectFavicon } from "./project-favicon";
import { useProjectActiveOperationCount } from "./project-operation-activity-provider";
import { useUiLocale } from "./ui-locale";


export function ProjectSelectOption({
  activeOperationCount,
  project
}: Readonly<{
  activeOperationCount?: number;
  project: Pick<AppProject, "id" | "name" | "version" | "activeOperationCount">;
}>) {
  const { t: uiText } = useUiLocale();
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
          aria-label={uiText("Активных операций: {0}", [String(operationCount)])}
          className="project-active-operation-count"
          title={uiText("Активных операций: {0}", [String(operationCount)])}
        >
          <span aria-hidden="true" className="project-active-operation-spinner" />
          {operationCount}
        </span>
      )}
    </span>
  );
}
