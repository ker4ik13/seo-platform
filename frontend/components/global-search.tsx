"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ProtectedAppContext } from "../lib/app-types";
import { browserApiRequest } from "../lib/browser-api";
import { projectSwitchHref, readLastWorkspaceProjectId, writeLastWorkspaceProjectId } from "../lib/app-navigation";
import { parseSearchProjects, searchTenantCatalog, type SearchProject } from "../lib/global-search";
import { Icon } from "./icon";
import { ProjectFavicon } from "./project-favicon";
import { WorkspaceAvatar } from "./workspace-avatar";

export function GlobalSearch({ context }: Readonly<{ context: ProtectedAppContext }>) {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<readonly SearchProject[]>(context.projects);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [revision, setRevision] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const results = useMemo(() => searchTenantCatalog(context.workspaces, projects, query), [context.workspaces, projects, query]);
  const rows = [
    ...results.workspaces.slice(0, 10).map((workspace) => ({ kind: "workspace" as const, workspace })),
    ...results.projects.slice(0, 30).map((project) => ({ kind: "project" as const, project }))
  ];
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    setProjects(context.projects);
    setLoaded(false);
  }, [context.projects, context.workspaces]);
  useEffect(() => {
    if (open) document.getElementById(`global-result-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘ K" : "Ctrl K");
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.code === "KeyK" || event.key.toLowerCase() === "k")) {
        event.preventDefault(); setOpen(true); input.current?.focus();
      } else if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", keydown); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", outside); };
  }, []);

  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    setLoading(true); setError(false);
    void (async () => {
      const catalog: SearchProject[] = [];
      let failed = false;
      // Bounded catalog reads happen once on opening, never per keystroke.
      for (let offset = 0; offset < context.workspaces.length; offset += 4) {
        const batch = await Promise.allSettled(context.workspaces.slice(offset, offset + 4).map(async (workspace) => {
          const value = await browserApiRequest<unknown>(`/app/api/workspaces/${workspace.id}/projects`, { signal: controller.signal });
          return parseSearchProjects(value, workspace.id);
        }));
        if (controller.signal.aborted) return;
        for (const result of batch) { if (result.status === "fulfilled") catalog.push(...result.value); else failed = true; }
      }
      setProjects(catalog); setError(failed); setLoading(false); setLoaded(true);
    })();
    return () => controller.abort();
  }, [context.workspaces, loaded, open, revision]);

  function choose(index: number) {
    const row = rows[index]; if (!row) return;
    const workspaceId = row.kind === "workspace" ? row.workspace.id : row.project.workspaceId;
    const preferred = readLastWorkspaceProjectId(window.localStorage, context.user.id, workspaceId);
    const available = projects.filter((project) => project.workspaceId === workspaceId);
    const projectId = row.kind === "project" ? row.project.id : available.find(({ id }) => id === preferred)?.id ?? available[0]?.id;
    document.cookie = `seo_workspace=${workspaceId}; Path=/; SameSite=Lax; Secure`;
    document.cookie = projectId ? `seo_project=${projectId}; Path=/; SameSite=Lax; Secure` : "seo_project=; Path=/; Max-Age=0; SameSite=Lax; Secure";
    if (projectId) writeLastWorkspaceProjectId(window.localStorage, context.user.id, workspaceId, projectId);
    window.location.assign(projectSwitchHref(pathname, projectId));
  }
  let previousKind: string | undefined;
  return <div className={`global-search-container${open ? " is-open" : ""}`} ref={root}>
    <label className="global-search" onClick={() => setOpen(true)}><Icon name="search" />
      <input aria-label="Глобальный поиск" aria-controls="global-search-results" aria-expanded={open}
        aria-activedescendant={open && rows[active] ? `global-result-${active}` : undefined} autoComplete="off"
        placeholder="Проекты, домены, рабочие области…" ref={input} role="combobox" value={query}
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, Math.min(rows.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Enter") { event.preventDefault(); choose(active); }
        }} type="search" /><kbd>{shortcut}</kbd>
    </label>
    {open && <div className="global-search-panel">
      <div className="global-search-caption">{loading ? "Загружаем доступные проекты…" : `Найдено: ${results.workspaces.length + results.projects.length}`}</div>
      {error && <div className="global-search-error" role="alert">Не все области удалось загрузить. <button onClick={() => { setLoaded(false); setRevision((value) => value + 1); }} type="button">Повторить</button></div>}
      <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Результаты поиска">
        {rows.map((row, index) => {
          const heading = row.kind !== previousKind; previousKind = row.kind;
          return <div key={row.kind === "project" ? row.project.id : row.workspace.id}>
            {heading && <div className="global-search-group">{row.kind === "workspace" ? "Рабочие области и пользователи" : "Проекты"}</div>}
            <button id={`global-result-${index}`} role="option" aria-selected={index === active} className={index === active ? "is-active" : ""} onMouseEnter={() => setActive(index)} onClick={() => choose(index)} type="button">
              {row.kind === "workspace" ? <WorkspaceAvatar workspace={row.workspace} size={40} /> : <span className="global-project-icon"><Icon name="projects" /><ProjectFavicon project={row.project} size={32} /></span>}
              <span className="global-result-text"><strong>{row.kind === "workspace" ? row.workspace.name : row.project.name}</strong><small>{row.kind === "workspace" ? `${row.workspace.owner.displayName} · ${row.workspace.owner.email}` : `${row.project.domain} · ${context.workspaces.find(({ id }) => id === row.project.workspaceId)?.name ?? ""}`}</small></span><Icon name="chevronRight" />
            </button>
          </div>;
        })}
        {!loading && rows.length === 0 && <div className="global-search-empty">Ничего не найдено. Попробуйте другое название или домен.</div>}
      </div>
      <footer>↑ ↓ — выбрать · Enter — открыть · Esc — закрыть{rows.length < results.workspaces.length + results.projects.length ? " · Уточните запрос для остальных результатов" : ""}</footer>
    </div>}
  </div>;
}
