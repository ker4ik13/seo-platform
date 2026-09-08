"use client";

import { CustomSelect } from "./custom-select";

import type {
  ProjectPageSettings,
  ProjectPageSummary,
  SemanticCluster,
  SemanticClusterMergeInput,
  SemanticClusterMergePreview,
  SemanticClusterMergeResult,
  SemanticClusterPageBulkInput,
  SemanticClusterPageBulkPreview,
  SemanticClusterPageBulkResult
} from "@seo-platform/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import {
  applySemanticClusterPageMappingInBatches,
  previewSemanticClusterPageMappingInBatches
} from "../lib/semantic-cluster-bulk";
import { UiText, useUiLocale } from "./ui-locale";


type ClusterEditor =
  | Readonly<{
      mode: "create";
      name: string;
      primaryPageId: string;
      pageMappingRationale: string;
      isLocked: boolean;
      excludeFromReclustering: boolean;
    }>
  | Readonly<{
      mode: "edit";
      clusterId: string;
      version: number;
      name: string;
      primaryPageId: string;
      pageMappingRationale: string;
      isLocked: boolean;
      excludeFromReclustering: boolean;
    }>;

export function SemanticClusterManager({
  projectId,
  onChanged
}: Readonly<{ projectId: string; onChanged: () => void }>) {
  const { t: uiText } = useUiLocale();
  const [clusters, setClusters] = useState<readonly SemanticCluster[]>([]);
  const [pages, setPages] = useState<readonly ProjectPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [bulkRationale, setBulkRationale] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"PREVIEW" | "APPLY">();
  const [bulkPreview, setBulkPreview] =
    useState<SemanticClusterPageBulkPreview>();
  const [bulkNotice, setBulkNotice] = useState<string>();
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeBusy, setMergeBusy] = useState<"PREVIEW" | "APPLY">();
  const [mergePreview, setMergePreview] = useState<SemanticClusterMergePreview>();
  const [selectedClusterIds, setSelectedClusterIds] =
    useState<readonly string[]>([]);
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
          setSelectedClusterIds((current) =>
            current.filter((id) =>
              clusterResult.some((cluster) => cluster.id === id)
            )
          );
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
      setSelectedClusterIds((current) =>
        current.filter((id) => id !== cluster.id)
      );
      if (editor?.mode === "edit" && editor.clusterId === cluster.id) {
        setEditor(undefined);
      }
      onChanged();
    } catch (requestError) {
      setError(clusterError(requestError));
    }
  }

  function toggleCluster(clusterId: string): void {
    setBulkPreview(undefined);
    setBulkNotice(undefined);
    setMergePreview(undefined);
    setMergeTargetId("");
    if (selectedClusterIds.includes(clusterId)) {
      setSelectedClusterIds((current) =>
        current.filter((id) => id !== clusterId)
      );
      return;
    }
    setSelectedClusterIds((current) => [...current, clusterId]);
  }

  function toggleVisibleClusters(): void {
    setBulkPreview(undefined);
    setBulkNotice(undefined);
    setMergePreview(undefined);
    setMergeTargetId("");
    if (selectedClusterIds.length > 0) {
      setSelectedClusterIds([]);
      return;
    }
    setSelectedClusterIds(clusters.map(({ id }) => id));
  }

  function changeBulkAction(value: string): void {
    setBulkAction(value);
    if (value === "CLEAR") setBulkRationale("");
    setBulkPreview(undefined);
    setBulkNotice(undefined);
  }

  function changeBulkRationale(value: string): void {
    setBulkRationale(value);
    setBulkPreview(undefined);
    setBulkNotice(undefined);
  }

  async function previewBulkPageMapping(): Promise<void> {
    const body = bulkPageMappingBody(
      clusters,
      selectedClusterIds,
      bulkAction,
      bulkRationale
    );
    if (!body || bulkBusy) return;
    setBulkBusy("PREVIEW");
    setError(undefined);
    setBulkNotice(undefined);
    try {
      setBulkPreview(
        await previewSemanticClusterPageMappingInBatches(projectId, body)
      );
    } catch (requestError) {
      setBulkPreview(undefined);
      setError(clusterError(requestError));
    } finally {
      setBulkBusy(undefined);
    }
  }

  async function applyBulkPageMapping(): Promise<void> {
    const body = bulkPageMappingBody(
      clusters,
      selectedClusterIds,
      bulkAction,
      bulkRationale
    );
    if (!body || !bulkPreview || bulkPreview.applicable === 0 || bulkBusy) {
      return;
    }
    setBulkBusy("APPLY");
    setError(undefined);
    setBulkNotice(undefined);
    try {
      const result = await applySemanticClusterPageMappingInBatches(
        projectId,
        body
      );
      setClusters((current) => mergeClusters(current, result.updatedClusters));
      setSelectedClusterIds([]);
      setBulkAction("");
      setBulkRationale("");
      setBulkPreview(undefined);
      setBulkNotice(bulkResultNotice(result));
      if (result.conflicted > 0) {
        setReloadVersion((value) => value + 1);
      }
      onChanged();
    } catch (requestError) {
      setError(clusterError(requestError));
    } finally {
      setBulkBusy(undefined);
    }
  }

  async function previewMerge(): Promise<void> {
    const body = mergeBody(clusters, selectedClusterIds, mergeTargetId);
    if (!body || mergeBusy) return;
    setMergeBusy("PREVIEW");
    setError(undefined);
    setBulkNotice(undefined);
    try {
      setMergePreview(
        await browserApiRequest<SemanticClusterMergePreview>(
          clusterPath(projectId, "merge-preview"),
          { method: "POST", body }
        )
      );
    } catch (requestError) {
      setMergePreview(undefined);
      setError(clusterError(requestError));
    } finally {
      setMergeBusy(undefined);
    }
  }

  async function applyMerge(): Promise<void> {
    const body = mergeBody(clusters, selectedClusterIds, mergeTargetId);
    if (!body || mergePreview?.readiness !== "READY" || mergeBusy) return;
    setMergeBusy("APPLY");
    setError(undefined);
    setBulkNotice(undefined);
    try {
      const result = await browserApiRequest<SemanticClusterMergeResult>(
        clusterPath(projectId, "merge"),
        { method: "POST", body }
      );
      const removed = new Set(result.mergedClusterIds);
      setClusters((current) =>
        mergeClusters(
          current.filter(({ id }) => !removed.has(id)),
          [result.targetCluster]
        )
      );
      setSelectedClusterIds([]);
      setMergeTargetId("");
      setMergePreview(undefined);
      setBulkNotice(
        `Объединено ${result.mergedClusterIds.length} кластеров, перенесено ${result.movedKeywordCount} запросов.`
      );
      onChanged();
    } catch (requestError) {
      setMergePreview(undefined);
      setError(clusterError(requestError));
    } finally {
      setMergeBusy(undefined);
    }
  }

  return (
    <section className="panel semantic-groups" aria-busy={loading}>
      <header className="panel-header">
        <div>
          <h2><UiText text="Кластеры" /></h2>
          <p><UiText text="Поисковые интенты для назначения и массовой обработки запросов" /></p>
        </div>
        <div className="semantic-cluster-header-actions">
          {clusters.length > 0 && (
            <button
              className="text-button"
              disabled={loading || Boolean(bulkBusy)}
              onClick={toggleVisibleClusters}
              type="button"
            >
              {selectedClusterIds.length > 0 ? <UiText text="Снять выбор" /> : <UiText text="Выбрать все" />}
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => setEditor({
              mode: "create",
              name: "",
              primaryPageId: "",
              pageMappingRationale: "",
              isLocked: false,
              excludeFromReclustering: false
            })}
            type="button"
          >
            <UiText text="Новый кластер" /></button>
        </div>
      </header>

      {editor && (
        <form className="semantic-cluster-editor" onSubmit={(event) => void save(event)}>
          <label>
            <span><UiText text="Название кластера" /></span>
            <input
              autoFocus
              maxLength={255}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, name: event.target.value } : current
                )
              }
              placeholder={uiText("Например, Купить кондиционер")}
              required
              value={editor.name}
            />
          </label>
          <div className="semantic-cluster-controls">
            <label>
              <input
                checked={editor.isLocked}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, isLocked: event.target.checked } : current
                  )
                }
                type="checkbox"
              />
              <span><UiText text="Зафиксировать кластер" /></span>
            </label>
            <label>
              <input
                checked={editor.excludeFromReclustering}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? { ...current, excludeFromReclustering: event.target.checked }
                      : current
                  )
                }
                type="checkbox"
              />
              <span><UiText text="Не включать в рекластеризацию" /></span>
            </label>
          </div>
          <label>
            <span><UiText text="Основная посадочная" /></span>
            <CustomSelect
              onChange={(event) =>
                setEditor((current) =>
                  current
                    ? { ...current, primaryPageId: event.target.value }
                    : current
                )
              }
              value={editor.primaryPageId}
            >
              <option value=""><UiText text="Не назначена" /></option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title ? `${page.title} · ` : ""}{page.normalizedUrl}
                </option>
              ))}
            </CustomSelect>
          </label>
          <label>
            <span><UiText text="Почему эта страница" /></span>
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
              placeholder={uiText("Интент, SERP или ручное решение")}
              value={editor.pageMappingRationale}
            />
          </label>
          <div className="semantic-group-editor-actions">
            <button className="text-button" disabled={saving} onClick={() => setEditor(undefined)} type="button">
              <UiText text="Отмена" /></button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button className="text-button" onClick={() => setReloadVersion((value) => value + 1)} type="button">
            <UiText text="Повторить" /></button>
        </div>
      )}

      {bulkNotice && (
        <div className="inline-alert success" role="status">{<UiText text={bulkNotice ?? ""} />}</div>
      )}

      {selectedClusterIds.length > 0 && (
        <section
          className="semantic-cluster-bulk"
          aria-busy={Boolean(bulkBusy || mergeBusy)}
        >
          <div className="semantic-bulk-heading">
            <div>
              <strong><UiText text="Действия с" after=" " />{selectedClusterIds.length} <UiText text="кластерами" before=" " /></strong>
              <span>
                <UiText text="Сначала проверьте изменения. Конфликтующие версии не перезаписываются." /></span>
            </div>
            <button
              className="text-button"
              disabled={Boolean(bulkBusy || mergeBusy)}
              onClick={() => {
                setSelectedClusterIds([]);
                setMergeTargetId("");
                setMergePreview(undefined);
              }}
              type="button"
            >
              <UiText text="Закрыть" /></button>
          </div>
          {selectedClusterIds.length >= 2 && selectedClusterIds.length <= 50 && (
            <details className="semantic-cluster-merge">
              <summary><UiText text="Объединить выбранные кластеры" /></summary>
              <div className="semantic-cluster-merge-controls">
                <label>
                  <span><UiText text="Кластер-получатель" /></span>
                  <CustomSelect
                    disabled={Boolean(mergeBusy)}
                    onChange={(event) => {
                      setMergeTargetId(event.target.value);
                      setMergePreview(undefined);
                    }}
                    value={mergeTargetId}
                  >
                    <option value=""><UiText text="Выберите кластер" /></option>
                    {clusters
                      .filter(({ id }) => selectedClusterIds.includes(id))
                      .map((cluster) => (
                        <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
                      ))}
                  </CustomSelect>
                </label>
                {mergePreview && (
                  <div className="semantic-cluster-bulk-preview" role="status">
                    <span><strong>{mergePreview.movedKeywordCount}</strong> <UiText text="запросов" before=" " /></span>
                    <span><strong>{mergePreview.sourceClusterCount}</strong> <UiText text="кластеров исчезнут" before=" " /></span>
                    {mergePreview.sourcePageConflictCount > 0 && (
                      <span className="warning">
                        <strong>{mergePreview.sourcePageConflictCount}</strong> <UiText text="других посадочных" before=" " /></span>
                    )}
                    {mergePreview.lockedClusterCount > 0 && (
                      <span><strong>{mergePreview.lockedClusterCount}</strong> <UiText text="зафиксировано" before=" " /></span>
                    )}
                    {mergePreview.readiness === "CONFLICTED" && (
                      <span className="danger"><UiText text="Список изменился — обновите данные" /></span>
                    )}
                    {mergePreview.readiness === "BACKGROUND_REQUIRED" && (
                      <span className="warning">
                        <UiText text="Больше" after=" " />{mergePreview.synchronousKeywordLimit} <UiText text="запросов — нужен фоновый merge" before=" " /></span>
                    )}
                  </div>
                )}
                <div className="semantic-editor-actions">
                  <button
                    className="secondary-button"
                    disabled={!mergeTargetId || Boolean(mergeBusy)}
                    onClick={() => void previewMerge()}
                    type="button"
                  >
                    {mergeBusy === "PREVIEW" ? <UiText text="Проверяем…" /> : <UiText text="Проверить merge" />}
                  </button>
                  {mergePreview?.readiness === "READY" && (
                    <button
                      className="primary-button"
                      disabled={Boolean(mergeBusy)}
                      onClick={() => void applyMerge()}
                      type="button"
                    >
                      {mergeBusy === "APPLY" ? <UiText text="Объединяем…" /> : <UiText text="Объединить" />}
                    </button>
                  )}
                </div>
              </div>
            </details>
          )}
          <div className="semantic-cluster-bulk-fields">
            <label>
              <span><UiText text="Действие" /></span>
              <CustomSelect
                disabled={Boolean(bulkBusy)}
                onChange={(event) => changeBulkAction(event.target.value)}
                value={bulkAction}
              >
                <option value=""><UiText text="Выберите действие" /></option>
                <option value="CLEAR"><UiText text="Снять основную посадочную" /></option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title ? `${page.title} · ` : ""}{page.normalizedUrl}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label>
              <span><UiText text="Обоснование" /></span>
              <input
                disabled={!bulkAction || bulkAction === "CLEAR" || Boolean(bulkBusy)}
                maxLength={2_000}
                onChange={(event) => changeBulkRationale(event.target.value)}
                placeholder={uiText("Интент, SERP или ручное решение")}
                value={bulkRationale}
              />
            </label>
          </div>
          {bulkPreview && (
            <div className="semantic-cluster-bulk-preview" role="status">
              <span><strong>{bulkPreview.applicable}</strong> <UiText text="будут изменены" before=" " /></span>
              <span><strong>{bulkPreview.skipped}</strong> <UiText text="уже совпадают" before=" " /></span>
              <span className={bulkPreview.conflicted > 0 ? "danger" : ""}>
                <strong>{bulkPreview.conflicted}</strong> <UiText text="конфликтов" before=" " /></span>
            </div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={!bulkAction || Boolean(bulkBusy)}
              onClick={() => void previewBulkPageMapping()}
              type="button"
            >
              {bulkBusy === "PREVIEW" ? <UiText text="Проверяем…" /> : <UiText text="Проверить" />}
            </button>
            {bulkPreview && (
              <button
                className="primary-button"
                disabled={bulkPreview.applicable === 0 || Boolean(bulkBusy)}
                onClick={() => void applyBulkPageMapping()}
                type="button"
              >
                {bulkBusy === "APPLY"
                  ? <UiText text="Применяем…" />
                  : <UiText text="Применить {0}" values={[String(bulkPreview.applicable)]} />}
              </button>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="semantic-group-skeleton" role="status"><UiText text="Загружаем кластеры…" /></div>
      ) : clusters.length === 0 ? (
        <div className="semantic-group-empty">
          <strong><UiText text="Кластеров пока нет" /></strong>
          <span><UiText text="Создайте первый поисковый интент и назначьте ему запросы." /></span>
        </div>
      ) : (
        <div className="semantic-group-list">
          {clusters.map((cluster) => (
            <div className="semantic-group-row semantic-cluster-row" key={cluster.id}>
              <label className="semantic-cluster-select">
                <input
                  aria-label={uiText("Выбрать кластер «{0}»", [String(cluster.name)])}
                  checked={selectedClusterIds.includes(cluster.id)}
                  disabled={Boolean(bulkBusy)}
                  onChange={() => toggleCluster(cluster.id)}
                  type="checkbox"
                />
              </label>
              <i aria-hidden="true" className="semantic-cluster-mark" />
              <div>
                <strong>{cluster.name}</strong>
                <span>
                  {cluster.keywordCount} {keywordLabel(cluster.keywordCount)}
                  {" · "}
                  {cluster.primaryPage
                    ? cluster.primaryPage.normalizedUrl
                    : <UiText text="посадочная не назначена" />}
                </span>
                <div className="semantic-cluster-diagnostics">
                  {cluster.pageDiagnostics.hasMissingLanding && (
                    <small className="warning"><UiText text="Нет основной посадочной" /></small>
                  )}
                  {cluster.pageDiagnostics.unmappedKeywordCount > 0 && (
                    <small>
                      {cluster.pageDiagnostics.unmappedKeywordCount} <UiText text="без URL" before=" " /></small>
                  )}
                  {cluster.pageDiagnostics.hasCannibalization && (
                    <small className="danger">
                      <UiText text="Каннибализация:" after=" " />{cluster.pageDiagnostics.competingPageCount}
                    </small>
                  )}
                  {cluster.isLocked && <small><UiText text="Зафиксирован" /></small>}
                  {cluster.excludeFromReclustering && (
                    <small><UiText text="Вне рекластеризации" /></small>
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
                  pageMappingRationale: cluster.pageMappingRationale ?? "",
                  isLocked: cluster.isLocked,
                  excludeFromReclustering: cluster.excludeFromReclustering
                })}
                type="button"
              >
                <UiText text="Изменить" /></button>
              <button
                className="text-button danger-text"
                onClick={() => void deleteCluster(cluster)}
                type="button"
              >
                <UiText text="Удалить" /></button>
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
      isLocked: editor.isLocked,
      excludeFromReclustering: editor.excludeFromReclustering,
      ...(editor.mode === "edit" ? { primaryPageId: null } : {})
    };
  }
  return {
    name: editor.name,
    isLocked: editor.isLocked,
    excludeFromReclustering: editor.excludeFromReclustering,
    primaryPageId: editor.primaryPageId,
    pageMappingSource: "MANUAL",
    ...(editor.pageMappingRationale.trim()
      ? { pageMappingRationale: editor.pageMappingRationale.trim() }
      : {})
  };
}

function mergeBody(
  clusters: readonly SemanticCluster[],
  selectedIds: readonly string[],
  targetClusterId: string
): SemanticClusterMergeInput | undefined {
  if (selectedIds.length < 2 || selectedIds.length > 50 || !targetClusterId) {
    return undefined;
  }
  const selected = new Set(selectedIds);
  const items = clusters
    .filter(({ id }) => selected.has(id))
    .map(({ id, version }) => ({ id, version }));
  if (
    items.length !== selectedIds.length ||
    !items.some(({ id }) => id === targetClusterId)
  ) {
    return undefined;
  }
  return { items, targetClusterId };
}

function bulkPageMappingBody(
  clusters: readonly SemanticCluster[],
  selectedIds: readonly string[],
  action: string,
  rationale: string
): SemanticClusterPageBulkInput | undefined {
  if (selectedIds.length === 0 || !action) return undefined;
  const selected = new Set(selectedIds);
  const items = clusters
    .filter(({ id }) => selected.has(id))
    .map(({ id, version }) => ({ id, version }));
  if (items.length !== selectedIds.length) return undefined;
  if (action === "CLEAR") return { items, primaryPageId: null };
  return {
    items,
    primaryPageId: action,
    pageMappingSource: "MANUAL",
    ...(rationale.trim() ? { pageMappingRationale: rationale.trim() } : {})
  };
}

function mergeClusters(
  current: readonly SemanticCluster[],
  updated: readonly SemanticCluster[]
): readonly SemanticCluster[] {
  const updates = new Map(updated.map((cluster) => [cluster.id, cluster]));
  return current
    .map((cluster) => updates.get(cluster.id) ?? cluster)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function bulkResultNotice(result: SemanticClusterPageBulkResult): string {
  const main = `Посадочная обновлена у ${result.changed} кластеров.`;
  if (result.conflicted > 0) {
    return `${main} ${result.conflicted} конфликтующих записей не изменены; список обновлён.`;
  }
  if (result.skipped > 0) {
    return `${main} ${result.skipped} уже соответствовали выбранному состоянию.`;
  }
  return main;
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
    if (error.code === "BACKGROUND_OPERATION_REQUIRED") return "Этот merge нужно выполнить фоновой операцией.";
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
