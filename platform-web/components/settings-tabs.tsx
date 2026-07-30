import {
  canViewProjectIntegrations,
  canViewWorkspaceIntegrations
} from "../lib/app-permissions";
import type { AppProject } from "../lib/app-types";

export function SettingsTabs({
  active,
  projectAccessLevel,
  projectId,
  workspaceRoleCode
}: Readonly<{
  active:
    | "workspace"
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
        aria-current={active === "workspace" ? "page" : undefined}
        className={active === "workspace" ? "active" : undefined}
        href="/app/settings/workspace"
      >
        Рабочая область
      </a>
      {projectId && (
        <a
          aria-current={active === "project" ? "page" : undefined}
          className={active === "project" ? "active" : undefined}
          href={`/app/projects/${encodeURIComponent(projectId)}/settings/general`}
        >
          Проект
        </a>
      )}
      <a
        aria-current={active === "security" ? "page" : undefined}
        className={active === "security" ? "active" : undefined}
        href="/app/settings/security"
      >
        Безопасность
      </a>
      <a
        aria-current={active === "notifications" ? "page" : undefined}
        className={active === "notifications" ? "active" : undefined}
        href="/app/settings/notifications"
      >
        Уведомления
      </a>
      {canViewWorkspaceIntegrations(workspaceRoleCode) && (
        <a
          aria-current={active === "integrations" ? "page" : undefined}
          className={active === "integrations" ? "active" : undefined}
          href="/app/settings/integrations"
        >
          Интеграции
        </a>
      )}
      {projectId &&
        canViewProjectIntegrations(
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
            Интеграции проекта
          </a>
        )}
      {projectId && (
        <a
          aria-current={
            active === "project-notifications" ? "page" : undefined
          }
          className={
            active === "project-notifications" ? "active" : undefined
          }
          href={`/app/projects/${encodeURIComponent(projectId)}/settings/notifications`}
        >
          Уведомления проекта
        </a>
      )}
    </nav>
  );
}
