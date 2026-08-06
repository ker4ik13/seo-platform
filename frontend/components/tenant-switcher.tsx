"use client";

import { useEffect } from "react";
import type {
  AppProject,
  AppWorkspace
} from "../lib/app-types";
import { CustomSelect } from "./custom-select";
import { ProjectSelectOption } from "./project-select-option";
import { WorkspaceAvatar } from "./workspace-avatar";

export function TenantSwitcher({
  currentUserId,
  workspaces,
  workspace,
  projects,
  project
}: Readonly<{
  currentUserId: string;
  workspaces: readonly AppWorkspace[];
  workspace: AppWorkspace | undefined;
  projects: readonly AppProject[];
  project: AppProject | undefined;
}>) {
  const workspaceId = workspace?.id;
  const projectId = project?.id;
  const projectWorkspaceId = project?.workspaceId;

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    writePreference("seo_workspace", workspaceId);
    writePreference(
      "seo_project",
      projectId && projectWorkspaceId === workspaceId ? projectId : ""
    );
  }, [projectId, projectWorkspaceId, workspaceId]);

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
        <CustomSelect
          aria-label="Рабочая область"
          className="tenant-workspace-select"
          disabled={workspaces.length === 0}
          onChange={(event) => selectWorkspace(event.target.value)}
          showSelectedCheck={false}
          value={workspace?.id ?? ""}
        >
          {workspaces.length === 0 && <option value="">Нет областей</option>}
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              <WorkspaceOption
                currentUserId={currentUserId}
                workspace={item}
              />
            </option>
          ))}
        </CustomSelect>
      </label>
      <label>
        <span>Проект</span>
        <CustomSelect
          aria-label="Проект"
          className="tenant-project-select"
          disabled={!workspace || projects.length === 0}
          onChange={(event) => selectProject(event.target.value)}
          showSelectedCheck={false}
          value={project?.id ?? ""}
        >
          {projects.length === 0 && <option value="">Нет проектов</option>}
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              <ProjectSelectOption project={item} />
            </option>
          ))}
        </CustomSelect>
      </label>
    </div>
  );
}

function WorkspaceOption({
  currentUserId,
  workspace
}: Readonly<{
  currentUserId: string;
  workspace: AppWorkspace;
}>) {
  const isPersonal = workspace.owner.userId === currentUserId;
  return (
    <span className="tenant-option tenant-workspace-option">
      <WorkspaceAvatar
        className="tenant-owner-avatar"
        size={26}
        workspace={workspace}
      />
      <span className="tenant-option-copy">
        <strong>{workspace.name}</strong>
        <small>
          {isPersonal
            ? "Личный"
            : `${workspace.owner.email} · ${workspace.owner.displayName}`}
        </small>
      </span>
    </span>
  );
}

function writePreference(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  if (!value) {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
