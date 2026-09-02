"use client";

import { useEffect } from "react";
import Link from "next/link";
import type {
  AppProject,
  AppWorkspace,
  ProtectedAppContext
} from "../lib/app-types";
import {
  readLastWorkspaceProjectId,
  shouldShowWorkspaceCreationAction,
  writeLastWorkspaceProjectId
} from "../lib/app-navigation";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { ProjectSelect } from "./project-select";
import { WorkspaceAvatar } from "./workspace-avatar";

export function TenantSwitcher({
  currentUserId,
  workspaces,
  workspace,
  projects,
  project,
  projectCapabilities
}: Readonly<{
  currentUserId: string;
  workspaces: readonly AppWorkspace[];
  workspace: AppWorkspace | undefined;
  projects: readonly AppProject[];
  project: AppProject | undefined;
  projectCapabilities: ProtectedAppContext["projectCapabilities"];
}>) {
  const workspaceId = workspace?.id;
  const projectId = project?.id;
  const projectWorkspaceId = project?.workspaceId;
  const showWorkspaceCreation = shouldShowWorkspaceCreationAction(
    currentUserId,
    workspaces
  );

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    writePreference("seo_workspace", workspaceId);
    writePreference(
      "seo_project",
      projectId && projectWorkspaceId === workspaceId ? projectId : ""
    );
    writeLastWorkspaceProjectId(
      window.localStorage,
      currentUserId,
      workspaceId,
      projectId && projectWorkspaceId === workspaceId ? projectId : undefined
    );
  }, [currentUserId, projectId, projectWorkspaceId, workspaceId]);

  function selectWorkspace(workspaceId: string): void {
    writePreference("seo_workspace", workspaceId);
    writePreference(
      "seo_project",
      readLastWorkspaceProjectId(
        window.localStorage,
        currentUserId,
        workspaceId
      ) ?? ""
    );
    window.location.assign("/app");
  }

  function selectProject(projectId: string): void {
    if (!workspaceId || !projects.some(({ id }) => id === projectId)) return;
    writePreference("seo_project", projectId);
    writeLastWorkspaceProjectId(
      window.localStorage,
      currentUserId,
      workspaceId,
      projectId
    );
    window.location.assign("/app");
  }

  const creation = projectCapabilities?.creation;
  const projectFooter = creation && creation.reason !== "PERMISSION_REQUIRED"
    ? creation.allowed
      ? (
          <Link
            className="tenant-create-project-action"
            href="/app/projects?create=1"
          >
            <span aria-hidden="true"><Icon name="plus" /></span>
            <span>
              <strong>Создать проект</strong>
              <small>{creation.used} из {creation.limit} проектов занято</small>
            </span>
          </Link>
        )
      : (
          <span
            aria-disabled="true"
            className="tenant-create-project-action is-disabled"
          >
            <span aria-hidden="true"><Icon name="plus" /></span>
            <span>
              <strong>
                {creation.reason === "LIMIT_REACHED"
                  ? "Лимит проектов исчерпан"
                  : "Создание временно недоступно"}
              </strong>
              <small>{creation.used} из {creation.limit} проектов занято</small>
            </span>
          </span>
        )
    : undefined;

  return (
    <div className="tenant-switcher">
      <label>
        <span>Рабочая область</span>
        <CustomSelect
          aria-label="Рабочая область"
          className="tenant-workspace-select"
          onChange={(event) => selectWorkspace(event.target.value)}
          popoverFooter={showWorkspaceCreation ? (
            <Link
              className="tenant-create-workspace-action"
              href="/app?createWorkspace=1#workspace-onboarding"
            >
              <span aria-hidden="true"><Icon name="plus" /></span>
              <span>
                <strong>Создать рабочую область</strong>
                <small>Проекты, команда и интеграции будут храниться здесь</small>
              </span>
            </Link>
          ) : undefined}
          showSelectedCheck={false}
          value={workspace?.id ?? ""}
        >
          {workspaces.length === 0 && <option disabled value="">Нет области</option>}
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
        <ProjectSelect
          ariaLabel="Проект"
          canReorder={projectCapabilities?.canReorder ?? false}
          className="tenant-project-select"
          disabled={!workspace || (projects.length === 0 && !projectFooter)}
          onChange={selectProject}
          popoverFooter={projectFooter}
          projects={projects}
          value={project?.id ?? ""}
          workspaceId={workspace?.id ?? ""}
        />
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
