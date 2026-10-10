"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import {
  canViewWorkspaceBilling,
  canViewWorkspaceTeam,
  canViewWorkspaceIntegrations
} from "../lib/app-permissions";
import type { AppProject } from "../lib/app-types";
import { Icon } from "./icon";
import { useUiLocale, UiText } from "./ui-locale";


export function SettingsTabs({
  active,
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
    | "api"
    | "notifications"
    | "integrations"
    | "project-notifications"
    | "ranking-contexts";
  projectId?: string;
  projectAccessLevel?: AppProject["projectAccessLevel"];
  workspaceRoleCode: string | undefined;
}>) {
  const { t: uiText } = useUiLocale();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const activeTitle = {
    overview: "Общие настройки", projects: "Проекты", billing: "Тариф и оплата",
    workspace: "Рабочая область", team: "Команда", roles: "Роли и права",
    project: "Основные настройки проекта", security: "Профиль и безопасность",
    api: "API-ключи", notifications: "Уведомления", integrations: "Интеграции",
    "project-notifications": "Уведомления проекта", "ranking-contexts": "Съём позиций"
  }[active];
  return (
    <nav
      className="settings-tabs"
      aria-label={uiText("Разделы настроек")}
      data-expanded={expanded}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          setExpanded(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <button
        ref={toggleRef}
        className="settings-navigation-toggle"
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={uiText("Разделы настроек: {0}", [uiText(activeTitle)])}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span><small><UiText text="Настройки" /></small><strong><UiText text={activeTitle} /></strong></span>
        <Icon className={expanded ? "expanded" : undefined} name="chevronDown" />
      </button>
      <div
        className="settings-navigation-links"
        id={panelId}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) {
            setExpanded(false);
          }
        }}
      >
      <Link
        aria-current={active === "overview" ? "page" : undefined}
        className={active === "overview" ? "active" : undefined}
        href="/app/settings"
      >
        <Icon name="settings" />
        <UiText text="Общие настройки" /></Link>
      <span className="settings-tabs-heading"><Icon name="projects" /><UiText text="Аккаунт" /></span>
      <Link
        aria-current={active === "security" ? "page" : undefined}
        className={active === "security" ? "active" : undefined}
        href="/app/settings/security"
      >
        <Icon name="settings" />
        <UiText text="Профиль и безопасность" /></Link>
      <Link
        aria-current={active === "notifications" ? "page" : undefined}
        className={active === "notifications" ? "active" : undefined}
        href="/app/settings/notifications"
      >
        <Icon name="bell" />
        <UiText text="Уведомления" /></Link>
      {workspaceRoleCode && (
        <Link
          aria-current={active === "api" ? "page" : undefined}
          className={active === "api" ? "active" : undefined}
          href="/app/settings/api"
        >
          <Icon name="tools" />
          <UiText text="API-ключи" /></Link>
      )}
      <span className="settings-tabs-heading"><Icon name="projects" /><UiText text="Рабочая область" /></span>
      <Link
        aria-current={active === "workspace" ? "page" : undefined}
        className={active === "workspace" ? "active" : undefined}
        href="/app/settings/workspace"
      >
        <Icon name="dashboard" />
        <UiText text="Рабочая область" /></Link>
      <Link
        aria-current={active === "projects" ? "page" : undefined}
        className={active === "projects" ? "active" : undefined}
        href="/app/settings/projects"
      >
        <Icon name="projects" />
        <UiText text="Проекты" /></Link>
      {canViewWorkspaceTeam(workspaceRoleCode) && (
        <>
          <Link
            aria-current={active === "team" ? "page" : undefined}
            className={active === "team" ? "active" : undefined}
            href="/app/settings/team"
          >
            <Icon name="competitors" />
            <UiText text="Команда" /></Link>
          <Link
            aria-current={active === "roles" ? "page" : undefined}
            className={active === "roles" ? "active" : undefined}
            href="/app/settings/roles"
          >
            <Icon name="settings" />
            <UiText text="Роли и права" /></Link>
        </>
      )}
      {canViewWorkspaceBilling(workspaceRoleCode) && (
        <Link
          aria-current={active === "billing" ? "page" : undefined}
          className={active === "billing" ? "active" : undefined}
          href="/app/settings/billing"
          prefetch={false}
        >
          <Icon name="tasks" />
          <UiText text="Тариф и оплата" /></Link>
      )}
      {canViewWorkspaceIntegrations(workspaceRoleCode) && (
        <Link
          aria-current={active === "integrations" ? "page" : undefined}
          className={active === "integrations" ? "active" : undefined}
          href="/app/settings/integrations"
        >
          <Icon name="tools" />
          <UiText text="Интеграции" /></Link>
      )}
      {projectId && (
        <>
          <span className="settings-tabs-heading"><Icon name="projects" /><UiText text="Текущий проект" /></span>
          <Link
            aria-current={active === "project" ? "page" : undefined}
            className={active === "project" ? "active" : undefined}
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/general`}
          >
            <Icon name="projects" />
            <UiText text="Основные настройки" /></Link>
          <Link
            aria-current={
              active === "project-notifications" ? "page" : undefined
            }
            className={
              active === "project-notifications" ? "active" : undefined
            }
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/notifications`}
          >
            <Icon name="bell" />
            <UiText text="Уведомления проекта" /></Link>
          <Link
            aria-current={active === "ranking-contexts" ? "page" : undefined}
            className={active === "ranking-contexts" ? "active" : undefined}
            href={`/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`}
          >
            <Icon name="positions" />
            <UiText text="Съём позиций" /></Link>
        </>
      )}
      </div>
    </nav>
  );
}
