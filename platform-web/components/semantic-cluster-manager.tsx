"use client";

import { useEffect, useState, type FormEvent } from "react";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";

interface SemanticCluster {
  readonly id: string;
  readonly name: string;
  readonly method: "MANUAL";
  readonly keywordCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type ClusterEditor =
  | Readonly<{ mode: "create"; name: string }>
  | Readonly<{
      mode: "edit";
      clusterId: string;
      version: number;
      name: string;
    }>;

export function SemanticClusterManager({
  projectId,
  onChanged
}: Readonly<{ projectId: string; onChanged: () => void }>) {
  const [clusters, setClusters] = useState<readonly SemanticCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [editor, setEditor] = useState<ClusterEditor>();
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticCluster[]>(clusterPath(projectId), {
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setClusters(result);
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
              body: { name: editor.name }
            })
          : await browserApiRequest<SemanticCluster>(
              clusterPath(projectId, editor.clusterId),
              {
                method: "PATCH",
                body: { name: editor.name },
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
          onClick={() => setEditor({ mode: "create", name: "" })}
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
                <span>{cluster.keywordCount} {keywordLabel(cluster.keywordCount)}</span>
              </div>
              <button
                className="text-button"
                onClick={() => setEditor({
                  mode: "edit",
                  clusterId: cluster.id,
                  version: cluster.version,
                  name: cluster.name
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

function clusterError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "DUPLICATE") return "Кластер с таким названием уже существует.";
    if (error.code === "VERSION_CONFLICT") return "Кластер уже изменён. Обновите список и повторите.";
    if (error.code === "RESOURCE_STATE_CONFLICT") return "Сначала перенесите запросы из этого кластера.";
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
