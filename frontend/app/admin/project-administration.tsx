"use client";

import { CustomSelect } from "../../components/custom-select";
import { AdminDirectorySortControl } from "../../components/admin-directory-sort";
import { AdminStateAction } from "../../components/admin-state-action";
import { useAdminDirectorySort } from "../../lib/use-admin-directory-sort";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  AdminProjectSearchResult,
  AdminProjectStatus,
  AdminProjectSummary
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { useAdminAutoRefresh } from "../../lib/use-admin-auto-refresh";
import { UiText, useUiLocale } from "../../components/ui-locale";


type ProjectStatusFilter = AdminProjectStatus | "ALL";

export function ProjectAdministration({ canControl = false }: Readonly<{ canControl?: boolean }>) {
  const { sort, changeSort } = useAdminDirectorySort("project");
  const { t: uiText } = useUiLocale();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatusFilter>("ALL");
  const [result, setResult] = useState<AdminProjectSearchResult>();
  const [selected, setSelected] = useState<AdminProjectSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const latestRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (search: string, projectStatus: ProjectStatusFilter, silent = false) => {
    latestRequest.current?.abort();
    const controller = new AbortController();
    latestRequest.current = controller;
    if (!silent) setLoading(true);
    setError(undefined);
    const params = new URLSearchParams({
      q: search.trim(),
      status: projectStatus
      , sort
    });
    const response = await adminApi<AdminProjectSearchResult>(
      `/api/projects?${params.toString()}`,
      { signal: controller.signal }
    );
    if (controller.signal.aborted) return;
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
  }, [sort]);

  useEffect(() => {
    void load(appliedQuery, status);
  }, [appliedQuery, load, status]);
  useAdminAutoRefresh(() => load(appliedQuery, status, true));
  useEffect(() => () => latestRequest.current?.abort(), []);

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
    if (query.trim() === appliedQuery) void load(appliedQuery, status);
    else setAppliedQuery(query.trim());
  }

  return (
    <div className="content project-admin">
      <form className="workspace-search admin-search-with-filter" onSubmit={search}>
        <label>
          <span className="sr-only"><UiText text="Поиск проекта" /></span>
          <input
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Проект, домен, workspace, UUID, автор или владелец")}
            value={query}
          />
        </label>
        <CustomSelect
          aria-label={uiText("Статус проекта")}
          onChange={(event) => setStatus(event.target.value as ProjectStatusFilter)}
          value={status}
        >
          <option value="ALL"><UiText text="Все статусы" /></option>
          <option value="ACTIVE"><UiText text="Активные" /></option>
          <option value="DRAFT"><UiText text="Черновики" /></option>
          <option value="ARCHIVED"><UiText text="В архиве" /></option>
          <option value="DELETING"><UiText text="Удаляются" /></option>
          <option value="DELETED"><UiText text="Удалённые" /></option>
        </CustomSelect>
        <AdminDirectorySortControl value={sort} onChange={changeSort} />
        <button className="primary" disabled={loading} type="submit">
          {loading ? <UiText text="Ищем…" /> : <UiText text="Найти" />}
        </button>
      </form>
      {error && <div className="form-alert workspace-message" role="alert">{<UiText text={error ?? ""} />}</div>}
      {result && !result.semanticCountsAvailable && (
        <aside className="warning">
          <strong><UiText text="SEO-data временно недоступен." /></strong>
          <span><UiText text="Проекты показаны, но счётчики ключей и папок появятся после восстановления сервиса." /></span>
        </aside>
      )}
      <section className="metric-grid workspace-metrics">
        <Metric label={uiText("Проектов")} value={metrics.projects} />
        <Metric label={uiText("Активных")} value={metrics.active} />
        <Metric label={uiText("Ключей")} value={metrics.keywords} />
        <Metric label={uiText("Папок")} value={metrics.folders} />
      </section>
      <section className="panel workspace-panel">
        {result?.truncated && (
          <div className="workspace-hint"><UiText text="Найдено больше 50 проектов. Уточните запрос." /></div>
        )}
        {loading ? (
          <div className="empty"><UiText text="Загружаем проекты…" /></div>
        ) : !result || result.data.length === 0 ? (
          <div className="empty"><strong><UiText text="Проекты не найдены" /></strong><span><UiText text="Измените запрос или статус." /></span></div>
        ) : (
          <div className="project-table">
            <div className="project-row project-head" aria-hidden="true">
              <span><UiText text="Проект" /></span><span>Workspace</span><span><UiText text="Автор / владелец" /></span>
              <span><UiText text="Семантика" /></span><span><UiText text="Обновлён" /></span><span />
            </div>
            {result.data.map((project) => (
              <ProjectRow key={project.id} onOpen={() => setSelected(project)} project={project} />
            ))}
          </div>
        )}
      </section>
      {selected && <ProjectDrawer canControl={canControl} onUpdated={() => void load(appliedQuery, status)} onClose={() => setSelected(undefined)} project={selected} />}
    </div>
  );
}

function ProjectRow({
  onOpen,
  project
}: Readonly<{ onOpen: () => void; project: AdminProjectSummary }>) {
  const uiLocale = useUiLocale().locale;
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
        <small>{samePerson ? <UiText text="Автор и владелец" /> : <UiText text="Автор · владелец {0}" values={[String(project.owner.displayName)]} />}</small>
      </div>
      <div className="workspace-counts project-counts" data-label="Семантика">
        <span><strong>{count(project.keywordCount, uiLocale)}</strong><small><UiText text="ключей" /></small></span>
        <span><strong>{count(project.folderCount, uiLocale)}</strong><small><UiText text="папок" /></small></span>
      </div>
      <time dateTime={project.updatedAt}>{formatDate(project.updatedAt, uiLocale)}</time>
      <button className="ghost workspace-open" onClick={onOpen} type="button"><UiText text="Открыть" /></button>
    </article>
  );
}

function ProjectDrawer({
  canControl,
  onUpdated,
  onClose,
  project
}: Readonly<{ canControl: boolean; onUpdated: () => void; onClose: () => void; project: AdminProjectSummary }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        aria-label={uiText("Проект {0}", [String(project.name)])}
        aria-modal="true"
        className="drawer workspace-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div><p><UiText text="Проект" /></p><h2>{project.name}</h2></div>
          <button aria-label={uiText("Закрыть")} onClick={onClose} type="button">×</button>
        </header>
        <div className="snapshot">
          <Snapshot label="Project ID" value={project.id} />
          <Snapshot label={uiText("Статус")} value={projectStatus(project.status)} />
          <Snapshot label={uiText("Домен")} value={project.domain} />
          <Snapshot label="Slug" value={project.slug} />
          <Snapshot label="Workspace" value={project.workspace.name} />
          <Snapshot label="Workspace ID" value={project.workspaceId} />
          <Snapshot label={uiText("Автор")} value={person(project.author)} />
          <Snapshot label={uiText("Владелец")} value={person(project.owner)} />
          <Snapshot label={uiText("Ключи")} value={count(project.keywordCount, uiLocale)} />
          <Snapshot label={uiText("Папки")} value={count(project.folderCount, uiLocale)} />
          <Snapshot label={uiText("Создан")} value={formatDate(project.createdAt, uiLocale)} />
          <Snapshot label={uiText("Обновлён")} value={formatDate(project.updatedAt, uiLocale)} />
        </div>
        <div className="workspace-readonly">
          {canControl && <div className="admin-control-actions"><AdminStateAction kind="USER" id={project.owner.userId} name={project.owner.displayName} status={project.owner.status} {...(project.owner.version ? { version: project.owner.version } : {})} onUpdated={onUpdated} /></div>}
          <strong><UiText text="Режим просмотра" /></strong>
          <p className="form-description"><UiText text="Из этого экрана данные проекта не изменяются." /></p>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number | null }>) {
  const uiLocale = useUiLocale().locale;
  return <article><span>{label}</span><strong>{value === null ? "—" : formatNumber(value, uiLocale)}</strong><small><UiText text="Текущая выборка" /></small></article>;
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

function count(value: number | null, uiLocale: string = "ru-RU"): string { return value === null ? "—" : formatNumber(value, uiLocale); }
function formatNumber(value: number, uiLocale: string = "ru-RU"): string { return new Intl.NumberFormat(uiLocale).format(value); }
function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function initials(value: string): string { return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "").join("") || "PR"; }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
function person(value: AdminProjectSummary["owner"]): string { return value.email ? `${value.displayName} · ${value.email}` : value.displayName; }
