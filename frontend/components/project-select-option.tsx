import type { AppProject } from "../lib/app-types";
import { projectFaviconUrl } from "../lib/app-path";
import { ProjectFavicon } from "./project-favicon";

export function ProjectSelectOption({
  project
}: Readonly<{
  project: Pick<AppProject, "domain" | "name">;
}>) {
  const hasSafeFaviconSource = Boolean(projectFaviconUrl(project.domain));
  return (
    <span className="project-select-option">
      {hasSafeFaviconSource && (
        <span aria-hidden="true" className="project-select-favicon-slot">
          <ProjectFavicon
            className="project-select-favicon"
            domain={project.domain}
          />
        </span>
      )}
      <strong title={project.name}>{project.name}</strong>
    </span>
  );
}
