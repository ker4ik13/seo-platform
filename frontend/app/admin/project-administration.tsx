"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import type {
  AdminProjectSearchResult,
  AdminProjectStatus,
  AdminProjectSummary
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";

type ProjectStatusFilter = AdminProjectStatus | "ALL";

export function ProjectAdministration() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatusFilter>("ALL");
  const [result, setResult] = useState<AdminProjectSearchResult>();
  const [selected, setSelected] = useState<AdminProjectSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async (search: string, projectStatus: ProjectStatusFilter) => {
    setLoading(true);
    setError(undefined);
    const params = new URLSearchParams({
      q: search.trim(),
      status: projectStatus
    });
    const response = await adminApi<AdminProjectSearchResult>(
      `/api/projects?${params.toString()}`
    );
    setLoading(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
    setSelected((current) =>
      current
        ? response.data.data.find((project) => project.id === current.id) ?? current
        : undefined
    );
  }, []);

  useEffect(() => {
    void load("", status);
  }, [load, status]);

  const metrics = useMemo(() => {
    const projects = result?.data ?? [];
    return {
      projects: projects.length,
      active: projects.filter((project) => project.status === "ACTIVE").length,
      keywords: sumKnown(projects.map((project) => project.keywordCount)),
      folders: sumKnown(projects.map((project) => project.folderCount))
    };
  }, [result]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query, status);
  }

  return (
    <div className="content project-admin">
      <section className="heading">
        <div><p>Platform directory</p><h1>Проекты</h1></div>
        <span className="external">Не более 50 проектов в выборке</span>
      </section>
      <form className="workspace-search admin-search-with-filter" onSubmit={search}>
        <label>
          <span className="sr-only">Поиск проекта</span>
          <input
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Проект, домен, workspace, UUID, автор или владелец"
            value={query}
          />
        </label>
        <select
          aria-label="Статус проекта"
          onChange={(event) => setStatus(event.target.value as ProjectStatusFilter)}
          value={status}
        >
          <option value="ALL">Все статусы</option>
          <option value="ACTIVE">Активные</option>
          <option value="DRAFT">Черновики</option>
          <option value="ARCHIVED">В архиве</option>
          <option value="DELETING">Удаляются</option>
          <option value="DELETED">Удалённые</option>
        </select>
        <button className="primary" disabled={loading} type="submit">
          {loading ? "Ищем…" : "Найти"}
        </button>
      </form>
      {error && <div className="form-alert workspace-message" role="alert">{error}</div>}
      {result && !result.semanticCountsAvailable && (
        <aside className="warning">
          <strong>SEO-data временно недоступен.</strong>
          <span>Проекты показаны, но счётчики ключей и папок появятся после восстановления сервиса.</span>
        </aside>
      )}
      <section className="metric-grid workspace-metrics">
        <Metric label="Проектов" value={metrics.projects} />
        <Metric label="Активных" value={metrics.active} />
        <Metric label="Ключей" value={metrics.keywords} />
        <Metric label="Папок" value={metrics.folders} />
      </section>
      <section className="panel workspace-panel">
        <header>
          <div>
            <h2>Проекты, авторы и использование</h2>
            <p>Системные папки и удалённые ключи в счётчики не входят</p>
          </div>
        </header>
        {result?.truncated && (
          <div className="workspace-hint">Найдено больше 50 проектов. Уточните запрос.</div>
        )}
        {loading ? (
          <div className="empty">Загружаем проекты…</div>
        ) : !result || result.data.length === 0 ? (
          <div className="empty"><strong>Проекты не найдены</strong><span>Измените запрос или статус.</span></div>
        ) : (
          <div className="project-table">
            <div className="project-row project-head" aria-hidden="true">
              <span>Проект</span><span>Workspace</span><span>Автор / владелец</span>
              <span>Семантика</span><span>Обновлён</span><span />
            </div>
            {result.data.map((project) => (
              <ProjectRow key={project.id} onOpen={() => setSelected(project)} project={project} />
            ))}
          </div>
        )}
      </section>
      {selected && <ProjectDrawer onClose={() => setSelected(undefined)} project={selected} />}
    </div>
  );
}

function ProjectRow({
  onOpen,
  project
}: Readonly<{ onOpen: () => void; project: AdminProjectSummary }>) {
  const samePerson = project.owner.userId === project.author.userId;
  return (
    <article className="project-row">
      <div className="workspace-primary project-primary">
        <span className="workspace-avatar">{initials(project.name)}</span>
        <div>
          <strong>{project.name}</strong>
          <small>{project.domain} · {shortId(project.id)}</small>
          <ProjectStatus status={project.status} />
        </div>
      </div>
      <div className="project-workspace" data-label="Workspace">
        <strong>{project.workspace.name}</strong>
        <small>{project.workspace.slug}</small>
      </div>
      <div className="project-people" data-label="Автор / владелец">
        <strong>{project.author.displayName}</strong>
        <small>{samePerson ? "Автор и владелец" : `Автор · владелец ${project.owner.displayName}`}</small>
      </div>
      <div className="workspace-counts project-counts" data-label="Семантика">
        <span><strong>{count(project.keywordCount)}</strong><small>ключей</small></span>
        <span><strong>{count(project.folderCount)}</strong><small>папок</small></span>
      </div>
      <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
      <button className="ghost workspace-open" onClick={onOpen} type="button">Открыть</button>
    </article>
  );
}

function ProjectDrawer({
  onClose,
  project
}: Readonly<{ onClose: () => void; project: AdminProjectSummary }>) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        aria-label={`Проект ${project.name}`}
        aria-modal="true"
        className="drawer workspace-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div><p>Проект</p><h2>{project.name}</h2></div>
          <button aria-label="Закрыть" onClick={onClose} type="button">×</button>
        </header>
        <div className="snapshot">
          <Snapshot label="Project ID" value={project.id} />
          <Snapshot label="Статус" value={projectStatus(project.status)} />
          <Snapshot label="Домен" value={project.domain} />
          <Snapshot label="Slug" value={project.slug} />
          <Snapshot label="Workspace" value={project.workspace.name} />
          <Snapshot label="Workspace ID" value={project.workspaceId} />
          <Snapshot label="Автор" value={person(project.author)} />
          <Snapshot label="Владелец" value={person(project.owner)} />
          <Snapshot label="Ключи" value={count(project.keywordCount)} />
          <Snapshot label="Папки" value={count(project.folderCount)} />
          <Snapshot label="Создан" value={formatDate(project.createdAt)} />
          <Snapshot label="Обновлён" value={formatDate(project.updatedAt)} />
        </div>
        <div className="workspace-readonly">
          <strong>Режим просмотра</strong>
          <p className="form-description">Из этого экрана данные проекта не изменяются.</p>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number | null }>) {
  return <article><span>{label}</span><strong>{value === null ? "—" : formatNumber(value)}</strong><small>Текущая выборка</small></article>;
}

function ProjectStatus({ status }: Readonly<{ status: string }>) {
  return <b className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}>{projectStatus(status)}</b>;
}

function Snapshot({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function projectStatus(value: string): string {
  return ({ DRAFT: "Черновик", ACTIVE: "Активен", ARCHIVED: "В архиве", DELETING: "Удаляется", DELETED: "Удалён" } as Record<string, string>)[value] ?? value;
}

function count(value: number | null): string { return value === null ? "—" : formatNumber(value); }
function formatNumber(value: number): string { return new Intl.NumberFormat("ru-RU").format(value); }
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function initials(value: string): string { return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "").join("") || "PR"; }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
function person(value: AdminProjectSummary["owner"]): string { return value.email ? `${value.displayName} · ${value.email}` : value.displayName; }
