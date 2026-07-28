"use client";

import type {
  AppProject,
  AppWorkspace
} from "../lib/app-types";

export function TenantSwitcher({
  workspaces,
  workspace,
  projects,
  project
}: Readonly<{
  workspaces: readonly AppWorkspace[];
  workspace: AppWorkspace | undefined;
  projects: readonly AppProject[];
  project: AppProject | undefined;
}>) {
  function selectWorkspace(workspaceId: string): void {
    writePreference("seo_workspace", workspaceId);
    writePreference("seo_project", "");
    window.location.assign("/app");
  }

  function selectProject(projectId: string): void {
    writePreference("seo_project", projectId);
    window.location.assign("/app");
  }

  return (
    <div className="tenant-switcher">
      <label>
        <span>Рабочая область</span>
        <select
          aria-label="Рабочая область"
          disabled={workspaces.length === 0}
          onChange={(event) => selectWorkspace(event.target.value)}
          value={workspace?.id ?? ""}
        >
          {workspaces.length === 0 && <option value="">Нет областей</option>}
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Проект</span>
        <select
          aria-label="Проект"
          disabled={!workspace || projects.length === 0}
          onChange={(event) => selectProject(event.target.value)}
          value={project?.id ?? ""}
        >
          {projects.length === 0 && <option value="">Нет проектов</option>}
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function writePreference(name: string, value: string): void {
  if (!value) {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
