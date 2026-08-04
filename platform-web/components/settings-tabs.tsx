import {
  canViewProjectIntegrations,
  canViewWorkspaceBilling,
  canViewWorkspaceTeam,
  canViewWorkspaceIntegrations
} from "../lib/app-permissions";
import type { AppProject } from "../lib/app-types";
import { Icon } from "./icon";

export function SettingsTabs({
  active,
  projectAccessLevel,
  projectId,
  workspaceRoleCode
}: Readonly<{
  active:
    | "overview"
    | "projects"
    | "billing"
    | "workspace"
    | "team"
    | "roles"
    | "project"
    | "security"
    | "notifications"
    | "integrations"
    | "project-notifications"
    | "project-integrations";
  projectId?: string;
  projectAccessLevel?: AppProject["projectAccessLevel"];
  workspaceRoleCode: string | undefined;
}>) {
  return (
    <nav className="settings-tabs" aria-label="Разделы настроек">
      <a
        aria-current={active === "overview" ? "page" : undefined}
        className={active === "overview" ? "active" : undefined}
        href="/app/settings"
      >
        <Icon name="settings" />
        Обзор настроек
      </a>
      <span className="settings-tabs-heading">Аккаунт</span>
      <a
        aria-current={active === "security" ? "page" : undefined}
        className={active === "security" ? "active" : undefined}
        href="/app/settings/security"
      >
        <Icon name="settings" />
        Профиль и безопасность
      </a>
      <a
        aria-current={active === "notifications" ? "page" : undefined}
        className={active === "notifications" ? "active" : undefined}
        href="/app/settings/notifications"
      >
        <Icon name="bell" />
        Уведомления
      </a>
      <span className="settings-tabs-heading">Рабочая область</span>
      <a
        aria-current={active === "workspace" ? "page" : undefined}
        className={active === "workspace" ? "active" : undefined}
        href="/app/settings/workspace"
      >
        <Icon name="dashboard" />
        Рабочая область
      </a>
      <a
        aria-current={active === "projects" ? "page" : undefined}
        className={active === "projects" ? "active" : undefined}
        href="/app/settings/projects"
      >
        <Icon name="projects" />
        Проекты
      </a>
      {canViewWorkspaceTeam(workspaceRoleCode) && (
        <>
          <a
            aria-current={active === "team" ? "page" : undefined}
            className={active === "team" ? "active" : undefined}
            href="/app/settings/team"
          >
            <Icon name="competitors" />
            Команда
          </a>
          <a
            aria-current={active === "roles" ? "page" : undefined}
            className={active === "roles" ? "active" : undefined}
            href="/app/settings/roles"
          >
            <Icon name="settings" />
            Роли и права
          </a>
        </>
      )}
      {canViewWorkspaceBilling(workspaceRoleCode) && (
        <a
          aria-current={active === "billing" ? "page" : undefined}
          className={active === "billing" ? "active" : undefined}
          href="/app/settings/billing"
        >
          <Icon name="tasks" />
          Тариф и оплата
        </a>
      )}
      {canViewWorkspaceIntegrations(workspaceRoleCode) && (
        <a
          aria-current={active === "integrations" ? "page" : undefined}
          className={active === "integrations" ? "active" : undefined}
          href="/app/settings/integrations"
        >
          <Icon name="tools" />
          Интеграции
        </a>
      )}
      {projectId && (
        <>
          <span className="settings-tabs-heading">Текущий проект</span>
          <a
            aria-current={active === "project" ? "page" : undefined}
            className={active === "project" ? "active" : undefined}
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/general`}
          >
            <Icon name="projects" />
            Основные настройки
          </a>
          {canViewProjectIntegrations(
            workspaceRoleCode,
            projectAccessLevel
          ) && (
            <a
              aria-current={
                active === "project-integrations" ? "page" : undefined
              }
              className={
                active === "project-integrations" ? "active" : undefined
              }
              href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}
            >
              <Icon name="tools" />
              Интеграции проекта
            </a>
          )}
          <a
            aria-current={
              active === "project-notifications" ? "page" : undefined
            }
            className={
              active === "project-notifications" ? "active" : undefined
            }
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/notifications`}
          >
            <Icon name="bell" />
            Уведомления проекта
          </a>
        </>
      )}
    </nav>
  );
}
