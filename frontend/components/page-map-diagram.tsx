"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectPageSummary, ProjectPageStatistics } from "@seo-platform/contracts";
import type { SiteStructureNode } from "../lib/site-structure";
import { pageMapLayout, PAGE_MAP_NODE_WIDTH, PAGE_MAP_NODE_HEIGHT } from "../lib/page-map-layout";
import { useCanvasViewport } from "../lib/use-canvas-viewport";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./page-map-diagram.module.css";

export function PageMapDiagram({ nodes, domain, total, pages, pageIdsByPath, expansion, selectedPageId, statistics, onToggle, onSelectPage, onSelectPath, onVisiblePages }: Readonly<{
  nodes: readonly SiteStructureNode[]; domain: string; total: number; pages: readonly ProjectPageSummary[]; pageIdsByPath: ReadonlyMap<string, string>; expansion: Readonly<Record<string, boolean>>;
  selectedPageId?: string | undefined; statistics: Readonly<Record<string, ProjectPageStatistics>>; onToggle: (path: string, expanded: boolean) => void;
  onSelectPage: (id: string) => void; onSelectPath: (path: string) => void; onVisiblePages: (ids: readonly string[]) => void;
}>) {
  const { locale, t } = useUiLocale();
  const { viewportRef, transform, dragging, setZoom, fit, viewportProps, canZoomIn, canZoomOut } = useCanvasViewport();
  const { zoom } = transform;
  const [size, setSize] = useState({ width: 1000, height: 800 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setSize({ width: viewport.clientWidth, height: viewport.clientHeight }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);
  const layout = useMemo(() => pageMapLayout(nodes, domain, total, pageIdsByPath, expansion), [nodes, domain, total, pageIdsByPath, expansion]);
  const bounds = { left: (-transform.x - 260) / zoom, right: (size.width - transform.x + 260) / zoom, top: (-transform.y - 180) / zoom, bottom: (size.height - transform.y + 180) / zoom };
  const visible = layout.nodes.filter(({ x, y }) => x + PAGE_MAP_NODE_WIDTH >= bounds.left && x <= bounds.right && y + PAGE_MAP_NODE_HEIGHT >= bounds.top && y <= bounds.bottom);
  const visibleKey = visible.flatMap((item) => item.pageId ? [item.pageId] : []).join(",");
  useEffect(() => { onVisiblePages(visibleKey ? visibleKey.split(",") : []); }, [visibleKey, onVisiblePages]);
  const positions = new Map(layout.nodes.map((item) => [item.node.path, item]));
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const selectNode = (path: string, pageId?: string) => pageId ? onSelectPage(pageId) : onSelectPath(path);

  return <div className={`${styles.viewport}${dragging ? ` ${styles.dragging}` : ""}`} ref={viewportRef} role="region" tabIndex={0} aria-label={t("Карта страниц — схема")} {...viewportProps} style={{ backgroundPosition: `${transform.x}px ${transform.y}px` }}>
    <div className={styles.tools} data-canvas-controls>
      <button aria-label={t("Уменьшить масштаб")} disabled={!canZoomOut} onClick={() => setZoom(zoom - .1)} type="button"><Icon name="minus" /></button>
      <button aria-label={t("Сбросить масштаб")} onClick={() => setZoom(1)} type="button">{Math.round(zoom * 100)}%</button>
      <button aria-label={t("Увеличить масштаб")} disabled={!canZoomIn} onClick={() => setZoom(zoom + .1)} type="button"><Icon name="plus" /></button>
      <button onClick={() => fit(layout.width, layout.height)} type="button"><UiText text="Вписать" /></button>
      <button aria-label={t("Показать весь сайт")} title={t("Показать весь сайт")} onClick={() => onSelectPath("/")} type="button"><Icon name="sitemap" /></button>
    </div>
    <div className={styles.canvas} data-canvas-transform style={{ width: layout.width, height: layout.height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${zoom})` }}>
      <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">{layout.nodes.flatMap((item) => {
        const parent = item.parent ? positions.get(item.parent) : undefined;
        if (!parent || Math.max(item.x + PAGE_MAP_NODE_WIDTH, parent.x + PAGE_MAP_NODE_WIDTH) < bounds.left || Math.min(item.x, parent.x) > bounds.right || item.y < bounds.top || parent.y > bounds.bottom) return [];
        const bottom = parent.y + PAGE_MAP_NODE_HEIGHT;
        return [<path key={item.node.path} d={item.parent === "/" ? `M${parent.x + 118} ${bottom}V145H${item.x + 118}V${item.y}` : `M${parent.x + 118} ${bottom}V${bottom + 12}H${item.x - 14}V${item.y + PAGE_MAP_NODE_HEIGHT / 2}H${item.x}`} />];
      })}</svg>
      {zoom < .35 ? <svg className={styles.overview} width={layout.width} height={layout.height}>{visible.map(({ node, pageId, x, y }) => <g key={node.path} role="button" tabIndex={0} aria-pressed={Boolean(pageId && pageId === selectedPageId)} aria-label={node.path} onClick={() => selectNode(node.path, pageId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.path, pageId); } }}><title>{node.path}</title><rect x={x} y={y} width={PAGE_MAP_NODE_WIDTH} height={PAGE_MAP_NODE_HEIGHT} rx={9} /><text x={x + 12} y={y + 28}>{node.name.length > 32 ? `${node.name.slice(0, 31)}…` : node.name}</text><text x={x + 12} y={y + 60}>{node.count} {t("страниц")}</text></g>)}</svg> : visible.map(({ node, pageId, x, y }) => {
        const page = pageId ? pageById.get(pageId) : undefined, stats = pageId ? statistics[pageId] : undefined;
        const expanded = expansion[node.path] !== false;
        const http = page?.latestCrawl?.statusCode || page?.httpStatus || stats?.httpStatus;
        const index = page?.latestCrawl?.indexability ?? page?.indexability ?? stats?.indexability;
        return <div className={`${styles.node}${pageId && selectedPageId === pageId ? ` ${styles.selected}` : ""}`} data-node-path={node.path} key={node.path} style={{ left: x, top: y }}>
          <button className={styles.nodeContent} aria-label={node.path} onClick={() => selectNode(node.path, pageId)} type="button"><header><Icon name={node.children.length ? "projects" : "pages"} /><strong title={node.path}>{node.name}</strong></header>
            <div className={styles.badges}>{http ? <span className={http >= 400 ? styles.error : http < 300 ? styles.good : undefined}>{http}</span> : pageId ? <span>—</span> : null}{index && index !== "INDEXABLE" && index !== "UNKNOWN" && <span className={styles.error}>{({ NOINDEX: "noindex", BLOCKED_ROBOTS: "robots.txt", REDIRECTED: "Редирект", CANONICALIZED: "Canonical", ERROR: "Ошибка" } as Record<string, string>)[index] ?? index}</span>}{node.children.length > 0 && <span>{node.count.toLocaleString(locale)} <UiText text="страниц" /></span>}</div>
            <small>{pageId ? <>{stats?.assignedCount ?? page?.assignedKeywordCount ?? "—"} <UiText text="запросов" /> · <UiText text="Средняя" /> {stats?.averagePosition?.toLocaleString(locale, { maximumFractionDigits: 2 }) ?? "—"}</> : <>{node.count.toLocaleString(locale)} <UiText text="страниц в разделе" /></>}</small>
          </button>
          {node.children.length > 0 && <button className={styles.toggle} data-canvas-controls aria-expanded={expanded} aria-label={t(expanded ? "Свернуть ветку {0}" : "Раскрыть ветку {0}", [node.path])} title={t(expanded ? "Свернуть ветку" : "Раскрыть ветку")} onClick={() => onToggle(node.path, expanded)} type="button"><Icon name="chevronDown" /></button>}
        </div>;
      })}
    </div>
  </div>;
}
