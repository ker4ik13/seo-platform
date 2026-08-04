"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { projectCreationErrorMessage } from "../lib/project-creation-error";
import { Icon } from "./icon";

export function ProjectCatalog({
  activeProjectId,
  projects,
  workspace
}: Readonly<{
  activeProjectId?: string;
  projects: readonly AppProject[];
  workspace: AppWorkspace;
}>) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [duplicateConfirmation, setDuplicateConfirmation] = useState(false);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.domain} ${project.slug}`
        .toLocaleLowerCase("ru")
        .includes(normalized)
    );
  }, [projects, query]);

  useEffect(() => {
    if (!createOpen) return;
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setCreateOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [createOpen]);

  function selectProject(projectId: string, destination = "/app"): void {
    writePreference("seo_workspace", workspace.id);
    writePreference("seo_project", projectId);
    window.location.assign(destination);
  }

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const project = await browserApiRequest<{ readonly id: string }>(
        `/app/api/workspaces/${encodeURIComponent(workspace.id)}/projects`,
        {
          method: "POST",
          body: {
            name: String(form.get("name") ?? "").trim(),
            domain: String(form.get("domain") ?? "").trim(),
            confirmDuplicateDomain:
              duplicateConfirmation &&
              form.get("confirmDuplicateDomain") === "on"
          }
        }
      );
      selectProject(project.id);
    } catch (requestError) {
      setBusy(false);
      if (
        requestError instanceof BrowserApiError &&
        requestError.code === "DUPLICATE"
      ) {
        setDuplicateConfirmation(true);
        setError("Такой домен уже используется. Подтвердите создание отдельного проекта.");
        return;
      }
      setError(projectCreationErrorMessage(requestError));
    }
  }

  return (
    <div className="project-catalog">
      <div className="project-catalog-toolbar">
        <label className="project-catalog-search">
          <Icon name="search" />
          <input
            aria-label="Поиск проектов"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или домен"
            type="search"
            value={query}
          />
        </label>
        <span>{visibleProjects.length} из {projects.length}</span>
        <button className="primary-button" onClick={() => setCreateOpen(true)} type="button">
          <Icon name="plus" /> Новый проект
        </button>
      </div>

      {visibleProjects.length === 0 ? (
        <section className="panel panel-empty compact">
          <span aria-hidden="true" className="state-icon">0</span>
          <strong>{projects.length === 0 ? "Проектов пока нет" : "Ничего не найдено"}</strong>
          <p>
            {projects.length === 0
              ? "Создайте первый проект и подключите семантику, позиции и технический аудит."
              : "Измените поисковый запрос или очистите поле."}
          </p>
          {projects.length === 0 && (
            <button className="primary-button" onClick={() => setCreateOpen(true)} type="button">
              <Icon name="plus" /> Создать проект
            </button>
          )}
        </section>
      ) : (
        <section className="project-catalog-grid" aria-label="Проекты workspace">
          {visibleProjects.map((project) => {
            const active = project.id === activeProjectId;
            return (
              <article className={active ? "project-card active" : "project-card"} key={project.id}>
                <header>
                  <span aria-hidden="true" className="project-card-mark">
                    {project.name.slice(0, 1).toLocaleUpperCase("ru")}
                  </span>
                  <div>
                    <h2>{project.name}</h2>
                    <a href={`https://${project.domain}`} rel="noreferrer" target="_blank">
                      {project.domain}
                    </a>
                  </div>
                  <span className={`project-status is-${project.status.toLocaleLowerCase()}`}>
                    {projectStatusLabel(project.status)}
                  </span>
                </header>
                <dl>
                  <div><dt>Доступ</dt><dd>{projectAccessLabel(project.projectAccessLevel)}</dd></div>
                  <div><dt>Локаль</dt><dd>{project.locale}</dd></div>
                  <div><dt>Версия</dt><dd>v{project.version}</dd></div>
                </dl>
                <footer>
                  <button
                    className="primary-button"
                    onClick={() => selectProject(project.id)}
                    type="button"
                  >
                    {active ? "Открыть обзор" : "Открыть проект"}
                  </button>
                  <button
                    aria-label={`Настройки проекта ${project.name}`}
                    className="secondary-button"
                    onClick={() =>
                      selectProject(
                        project.id,
                        `/app/projects/${encodeURIComponent(project.id)}/settings/general`
                      )
                    }
                    type="button"
                  >
                    Настройки
                  </button>
                </footer>
              </article>
            );
          })}
        </section>
      )}

      {createOpen && (
        <div
          className="project-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCreateOpen(false);
          }}
          role="presentation"
        >
          <section aria-labelledby="create-project-title" aria-modal="true" className="project-dialog" role="dialog">
            <header>
              <div>
                <h2 id="create-project-title">Новый проект</h2>
                <p>Домен, семантика и история операций будут изолированы внутри проекта.</p>
              </div>
              <button aria-label="Закрыть" onClick={() => setCreateOpen(false)} type="button">×</button>
            </header>
            <form className="onboarding-form" onSubmit={createProject}>
              {error && <div className="inline-alert danger" role="alert">{error}</div>}
              <label className="form-field">
                <span>Название проекта</span>
                <input autoFocus maxLength={160} name="name" placeholder="Например, Основной сайт" required />
              </label>
              <label className="form-field">
                <span>Домен</span>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  name="domain"
                  onChange={() => {
                    setDuplicateConfirmation(false);
                    setError(undefined);
                  }}
                  placeholder="example.com"
                  required
                />
                <small>Без протокола, пути, параметров и порта</small>
              </label>
              {duplicateConfirmation && (
                <label className="checkbox-field">
                  <input name="confirmDuplicateDomain" required type="checkbox" />
                  <span>Да, это отдельный проект с тем же доменом</span>
                </label>
              )}
              <footer>
                <button className="secondary-button" onClick={() => setCreateOpen(false)} type="button">Отмена</button>
                <button className="primary-button" disabled={busy} type="submit">{busy ? "Создаём…" : "Создать проект"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
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
