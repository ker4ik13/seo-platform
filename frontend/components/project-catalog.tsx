"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectCollectionCapabilities } from "@seo-platform/contracts";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import { ProjectCreationWizard } from "./project-creation-wizard";
import { Icon } from "./icon";
import { ProjectFavicon } from "./project-favicon";
import { useUiLocale, UiText } from "./ui-locale";


export function ProjectCatalog({
  activeProjectId,
  currentUserId,
  capabilities,
  initialCreateOpen = false,
  projects,
  workspace
}: Readonly<{
  activeProjectId?: string;
  currentUserId: string;
  capabilities?: ProjectCollectionCapabilities;
  initialCreateOpen?: boolean;
  projects: readonly AppProject[];
  workspace: AppWorkspace;
}>) {
  const { t: uiText } = useUiLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const canCreate = capabilities?.creation.allowed ?? false;
  const [createOpen, setCreateOpen] = useState(
    initialCreateOpen && canCreate
  );

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.domain} ${project.slug}`
        .toLocaleLowerCase("ru")
        .includes(normalized)
    );
  }, [projects, query]);

  function selectProject(projectId: string, destination = "/app"): void {
    writePreference("seo_workspace", workspace.id);
    writePreference("seo_project", projectId);
    window.location.assign(destination);
  }

  return (
    <div className="project-catalog">
      <div className="project-catalog-toolbar">
        <label className="project-catalog-search">
          <Icon name="search" />
          <input
            aria-label={uiText("Поиск проектов")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Название или домен")}
            type="search"
            value={query}
          />
        </label>
        <span>
          {capabilities
            ? <>{capabilities.creation.used} <UiText text="из" before=" " after=" " />{capabilities.creation.limit} <UiText text="проектов занято" before=" " /></>
            : <>{visibleProjects.length} <UiText text="из" before=" " after=" " />{projects.length}</>}
        </span>
        <button
          className="primary-button"
          disabled={!canCreate}
          onClick={() => setCreateOpen(true)}
          title={projectCreationAvailabilityLabel(capabilities)}
          type="button"
        >
          <Icon name="plus" /> <UiText text="Новый проект" before=" " /></button>
      </div>

      {visibleProjects.length === 0 ? (
        <section className="panel panel-empty compact">
          <span aria-hidden="true" className="state-icon">0</span>
          <strong>{projects.length === 0 ? <UiText text="Проектов пока нет" /> : <UiText text="Ничего не найдено" />}</strong>
          <p>
            {projects.length === 0
              ? <UiText text="Создайте первый проект и подключите семантику, позиции и технический аудит." />
              : <UiText text="Измените поисковый запрос или очистите поле." />}
          </p>
          {projects.length === 0 && (
            <button
              className="primary-button"
              disabled={!canCreate}
              onClick={() => setCreateOpen(true)}
              title={projectCreationAvailabilityLabel(capabilities)}
              type="button"
            >
              <Icon name="plus" /> <UiText text="Создать проект" before=" " /></button>
          )}
        </section>
      ) : (
        <section className="project-catalog-grid" aria-label={uiText("Проекты workspace")}>
          {visibleProjects.map((project) => {
            const active = project.id === activeProjectId;
            return (
              <article className={active ? "project-card active" : "project-card"} key={project.id}>
                <header>
                  <span aria-hidden="true" className="project-card-favicon-slot">
                    <ProjectFavicon
                      className="project-card-favicon"
                      project={project}
                      size={28}
                    />
                  </span>
                  <div>
                    <h2>{project.name}</h2>
                    <a href={`https://${project.domain}`} rel="noreferrer" target="_blank">
                      {project.domain}
                    </a>
                  </div>
                  <span className={`project-status is-${project.status.toLocaleLowerCase()}`}>
                    {<UiText text={projectStatusLabel(project.status) ?? ""} />}
                  </span>
                </header>
                <dl>
                  <div><dt><UiText text="Доступ" /></dt><dd>{<UiText text={projectAccessLabel(project.projectAccessLevel) ?? ""} />}</dd></div>
                  <div><dt><UiText text="Локаль" /></dt><dd>{project.locale}</dd></div>
                  <div><dt><UiText text="Версия" /></dt><dd>v{project.version}</dd></div>
                </dl>
                <footer>
                  <button
                    className="primary-button"
                    onClick={() => selectProject(project.id)}
                    type="button"
                  >
                    {active ? <UiText text="Открыть обзор" /> : <UiText text="Открыть проект" />}
                  </button>
                  <button
                    aria-label={uiText("Настройки проекта {0}", [String(project.name)])}
                    className="secondary-button"
                    onClick={() =>
                      selectProject(
                        project.id,
                        `/app/projects/${encodeURIComponent(project.id)}/settings/general`
                      )
                    }
                    type="button"
                  >
                    <UiText text="Настройки" /></button>
                </footer>
              </article>
            );
          })}
        </section>
      )}

      {createOpen && <ProjectCreationWizard
        key={currentUserId + ":" + workspace.id}
        currentUserId={currentUserId} workspace={workspace}
        {...(capabilities ? { capabilities } : {})}
        onClose={(createdId) => { setCreateOpen(false); if (createdId) router.refresh(); }}
        onOpenProject={(projectId) => selectProject(projectId, "/app/semantics")}
      />}

    </div>
  );
}

function writePreference(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function projectStatusLabel(status: AppProject["status"]): string {
  if (status === "ACTIVE") return "Активен";
  if (status === "ARCHIVED") return "В архиве";
  return "Черновик";
}

function projectAccessLabel(level: AppProject["projectAccessLevel"]): string {
  if (level === "MANAGER") return "Менеджер";
  if (level === "MEMBER") return "Участник";
  if (level === "VIEWER") return "Наблюдатель";
  if (level === "NONE") return "Нет доступа";
  return "По роли";
}

function projectCreationAvailabilityLabel(
  capabilities: ProjectCollectionCapabilities | undefined
): string | undefined {
  const creation = capabilities?.creation;
  if (!creation || creation.allowed) return undefined;
  if (creation.reason === "LIMIT_REACHED") {
    return `Лимит проектов исчерпан: ${creation.used} из ${creation.limit}`;
  }
  if (creation.reason === "WORKSPACE_READ_ONLY") {
    return "Рабочая область доступна только для чтения";
  }
  return "Недостаточно прав для создания проекта";
}
