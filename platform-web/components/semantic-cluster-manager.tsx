"use client";

import type {
  ProjectPageSettings,
  ProjectPageSummary,
  SemanticCluster
} from "@seo-platform/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";

type ClusterEditor =
  | Readonly<{
      mode: "create";
      name: string;
      primaryPageId: string;
      pageMappingRationale: string;
    }>
  | Readonly<{
      mode: "edit";
      clusterId: string;
      version: number;
      name: string;
      primaryPageId: string;
      pageMappingRationale: string;
    }>;

export function SemanticClusterManager({
  projectId,
  onChanged
}: Readonly<{ projectId: string; onChanged: () => void }>) {
  const [clusters, setClusters] = useState<readonly SemanticCluster[]>([]);
  const [pages, setPages] = useState<readonly ProjectPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [editor, setEditor] = useState<ClusterEditor>();
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void Promise.all([
      browserApiRequest<readonly SemanticCluster[]>(clusterPath(projectId), {
        signal: controller.signal
      }),
      loadActivePages(projectId, controller.signal)
    ])
      .then(([clusterResult, pageResult]) => {
        if (!controller.signal.aborted) {
          setClusters(clusterResult);
          setPages(pageResult);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(clusterError(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, reloadVersion]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result =
        editor.mode === "create"
          ? await browserApiRequest<SemanticCluster>(clusterPath(projectId), {
              method: "POST",
              body: clusterBody(editor)
            })
          : await browserApiRequest<SemanticCluster>(
              clusterPath(projectId, editor.clusterId),
              {
                method: "PATCH",
                body: clusterBody(editor),
                ifMatch: editor.version
              }
            );
      setClusters((current) =>
        [...current.filter(({ id }) => id !== result.id), result].sort((a, b) =>
          a.name.localeCompare(b.name, "ru")
        )
      );
      setEditor(undefined);
      onChanged();
    } catch (requestError) {
      setError(clusterError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCluster(cluster: SemanticCluster): Promise<void> {
    if (!window.confirm(`Удалить кластер «${cluster.name}»?`)) return;
    setError(undefined);
    try {
      await browserApiRequest<void>(clusterPath(projectId, cluster.id), {
        method: "DELETE",
        ifMatch: cluster.version
      });
      setClusters((current) => current.filter(({ id }) => id !== cluster.id));
      if (editor?.mode === "edit" && editor.clusterId === cluster.id) {
        setEditor(undefined);
      }
      onChanged();
    } catch (requestError) {
      setError(clusterError(requestError));
    }
  }

  return (
    <section className="panel semantic-groups" aria-busy={loading}>
      <header className="panel-header">
        <div>
          <h2>Кластеры</h2>
          <p>Поисковые интенты для назначения и массовой обработки запросов</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setEditor({
            mode: "create",
            name: "",
            primaryPageId: "",
            pageMappingRationale: ""
          })}
          type="button"
        >
          Новый кластер
        </button>
      </header>

      {editor && (
        <form className="semantic-cluster-editor" onSubmit={(event) => void save(event)}>
          <label>
            <span>Название кластера</span>
            <input
              autoFocus
              maxLength={255}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, name: event.target.value } : current
                )
              }
              placeholder="Например, Купить кондиционер"
              required
              value={editor.name}
            />
          </label>
          <label>
            <span>Основная посадочная</span>
            <select
              onChange={(event) =>
                setEditor((current) =>
                  current
                    ? { ...current, primaryPageId: event.target.value }
                    : current
                )
              }
              value={editor.primaryPageId}
            >
              <option value="">Не назначена</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title ? `${page.title} · ` : ""}{page.normalizedUrl}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Почему эта страница</span>
            <input
              disabled={!editor.primaryPageId}
              maxLength={2_000}
              onChange={(event) =>
                setEditor((current) =>
                  current
                    ? { ...current, pageMappingRationale: event.target.value }
                    : current
                )
              }
              placeholder="Интент, SERP или ручное решение"
              value={editor.pageMappingRationale}
            />
          </label>
          <div className="semantic-group-editor-actions">
            <button className="text-button" disabled={saving} onClick={() => setEditor(undefined)} type="button">
              Отмена
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => setReloadVersion((value) => value + 1)} type="button">
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <div className="semantic-group-skeleton" role="status">Загружаем кластеры…</div>
      ) : clusters.length === 0 ? (
        <div className="semantic-group-empty">
          <strong>Кластеров пока нет</strong>
          <span>Создайте первый поисковый интент и назначьте ему запросы.</span>
        </div>
      ) : (
        <div className="semantic-group-list">
          {clusters.map((cluster) => (
            <div className="semantic-group-row" key={cluster.id}>
              <i aria-hidden="true" className="semantic-cluster-mark" />
              <div>
                <strong>{cluster.name}</strong>
                <span>
                  {cluster.keywordCount} {keywordLabel(cluster.keywordCount)}
                  {" · "}
                  {cluster.primaryPage
                    ? cluster.primaryPage.normalizedUrl
                    : "посадочная не назначена"}
                </span>
                <div className="semantic-cluster-diagnostics">
                  {cluster.pageDiagnostics.hasMissingLanding && (
                    <small className="warning">Нет основной посадочной</small>
                  )}
                  {cluster.pageDiagnostics.unmappedKeywordCount > 0 && (
                    <small>
                      {cluster.pageDiagnostics.unmappedKeywordCount} без URL
                    </small>
                  )}
                  {cluster.pageDiagnostics.hasCannibalization && (
                    <small className="danger">
                      Каннибализация: {cluster.pageDiagnostics.competingPageCount}
                    </small>
                  )}
                </div>
              </div>
              <button
                className="text-button"
                onClick={() => setEditor({
                  mode: "edit",
                  clusterId: cluster.id,
                  version: cluster.version,
                  name: cluster.name,
                  primaryPageId: cluster.primaryPage?.id ?? "",
                  pageMappingRationale: cluster.pageMappingRationale ?? ""
                })}
                type="button"
              >
                Изменить
              </button>
              <button
                className="text-button danger-text"
                onClick={() => void deleteCluster(cluster)}
                type="button"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function clusterPath(projectId: string, clusterId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(projectId)}/clusters`;
  return clusterId ? `${base}/${encodeURIComponent(clusterId)}` : base;
}

function clusterBody(editor: ClusterEditor): Readonly<Record<string, unknown>> {
  if (!editor.primaryPageId) {
    return {
      name: editor.name,
      ...(editor.mode === "edit" ? { primaryPageId: null } : {})
    };
  }
  return {
    name: editor.name,
    primaryPageId: editor.primaryPageId,
    pageMappingSource: "MANUAL",
    ...(editor.pageMappingRationale.trim()
      ? { pageMappingRationale: editor.pageMappingRationale.trim() }
      : {})
  };
}

async function loadActivePages(
  projectId: string,
  signal: AbortSignal
): Promise<readonly ProjectPageSummary[]> {
  const result: ProjectPageSummary[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100", lifecycleStatus: "ACTIVE" });
    if (cursor) query.set("cursor", cursor);
    const page = await browserApiRequest<ProjectPageSettings>(
      `/app/api/projects/${encodeURIComponent(projectId)}/pages?${query.toString()}`,
      { signal }
    );
    result.push(...page.pages);
    cursor = page.nextCursor;
  } while (cursor && result.length < 2_000);
  return result;
}

function clusterError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "DUPLICATE") return "Кластер с таким названием уже существует.";
    if (error.code === "VERSION_CONFLICT") return "Кластер уже изменён. Обновите список и повторите.";
    if (error.code === "RESOURCE_STATE_CONFLICT") return "Сначала перенесите запросы из этого кластера.";
    if (error.code === "PAGE_UNAVAILABLE") return "Выбранная страница больше недоступна. Обновите список.";
    if (error.code === "FORBIDDEN") return "У вас нет права изменять кластеры.";
    return error.message;
  }
  return "Не удалось выполнить операцию с кластером.";
}

function keywordLabel(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "запросов";
  if (mod10 === 1) return "запрос";
  if (mod10 >= 2 && mod10 <= 4) return "запроса";
  return "запросов";
}
