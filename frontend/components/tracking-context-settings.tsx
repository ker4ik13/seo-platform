"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  parseRankDimensionMergeSettings,
  type RankDimensionMergeSettings,
  type RankDimensionMergeSummary,
  type SemanticRankDimension,
  type TrackingContextSettings,
  type TrackingContextSummary
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import {
  defaultTrackingContextSettingsDraft,
  trackingContextApiPath,
  trackingContextCreateInput,
  trackingContextDisplayName,
  trackingContextDraft,
  validateTrackingContextDraft,
  withTrackingContext,
  type TrackingContextDraft
} from "../lib/tracking-contexts";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticRankContext } from "./semantic-rank-context";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";


interface ContextGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

export function TrackingContextSettingsPanel({
  projectId
}: Readonly<{ projectId: string }>) {
  const { t: uiText } = useUiLocale();
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [rankMergeSettings, setRankMergeSettings] =
    useState<RankDimensionMergeSettings>();
  const [mergeSourceKey, setMergeSourceKey] = useState("");
  const [mergeTargetKey, setMergeTargetKey] = useState("");
  const [merging, setMerging] = useState(false);
  const [groups, setGroups] = useState<readonly ContextGroup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(defaultTrackingContextSettingsDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selected = settings?.contexts.find(({ id }) => id === selectedId);
  const mergeSources = useMemo(() => {
    if (!rankMergeSettings) return [];
    const occupied = new Set(
      rankMergeSettings.merges.flatMap(({ source, target }) => [source.key, target.key])
    );
    return rankMergeSettings.dimensions.filter((dimension) =>
      !occupied.has(dimension.key) &&
      rankMergeSettings.dimensions.some((target) =>
        target.key !== dimension.key &&
        !rankMergeSettings.merges.some(({ source }) => source.key === target.key) &&
        compatibleRankDimensions(dimension, target)
      )
    );
  }, [rankMergeSettings]);
  const selectedMergeSource = rankMergeSettings?.dimensions.find(
    ({ key }) => key === mergeSourceKey
  );
  const mergeTargets = useMemo(() => {
    if (!rankMergeSettings || !selectedMergeSource) return [];
    const sourceKeys = new Set(
      rankMergeSettings.merges.map(({ source }) => source.key)
    );
    return rankMergeSettings.dimensions.filter((dimension) =>
      dimension.key !== selectedMergeSource.key &&
      !sourceKeys.has(dimension.key) &&
      compatibleRankDimensions(selectedMergeSource, dimension)
    );
  }, [rankMergeSettings, selectedMergeSource]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      browserApiRequest<TrackingContextSettings>(
        `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
        { signal: controller.signal }
      ),
      browserApiRequest<readonly ContextGroup[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
        { signal: controller.signal }
      ),
      browserApiRequest<unknown>(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/dimension-merges`,
        { signal: controller.signal }
      ).then(parseRankDimensionMergeSettings)
    ])
      .then(([contextSettings, contextGroups, mergeSettings]) => {
        if (controller.signal.aborted) return;
        setSettings(contextSettings);
        setGroups(
          contextGroups.filter(({ systemKind }) => systemKind !== "TRASH")
        );
        setRankMergeSettings(mergeSettings);
        const first =
          contextSettings.contexts.find(({ status }) => status === "ACTIVE") ??
          contextSettings.contexts[0];
        if (first) {
          setSelectedId(first.id);
          setDraft(trackingContextDraft(first));
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Не удалось загрузить контексты позиций."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  function choose(context: TrackingContextSummary): void {
    setSelectedId(context.id);
    setDraft(trackingContextDraft(context));
    setDeleteConfirmationOpen(false);
    setError(undefined);
    setNotice(undefined);
  }

  function startNew(): void {
    setSelectedId("");
    setDraft(defaultTrackingContextSettingsDraft());
    setDeleteConfirmationOpen(false);
    setError(undefined);
    setNotice(undefined);
  }

  async function save(): Promise<void> {
    if (saving || !settings?.access.canConfigure) return;
    const validation = validateTrackingContextDraft(draft);
    const firstError = Object.values(validation)[0];
    if (firstError) {
      setError(firstError);
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const context = selected
        ? await browserApiRequest<TrackingContextSummary>(
            trackingContextApiPath(projectId, selected.id),
            {
              method: "PATCH",
              ifMatch: selected.version,
              body: trackingContextCreateInput(draft)
            }
          )
        : await browserApiRequest<TrackingContextSummary>(
            `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
            {
              method: "POST",
              idempotencyKey: `tracking-context-settings:${crypto.randomUUID()}`,
              body: trackingContextCreateInput(draft)
            }
          );
      setSettings((current) =>
        current ? withTrackingContext(current, context) : current
      );
      setSelectedId(context.id);
      setDraft(trackingContextDraft(context));
      setNotice(selected ? "Контекст обновлён." : "Контекст создан.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сохранить контекст."
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(): Promise<void> {
    if (!selected || saving || !settings?.access.canConfigure) return;
    const action = selected.status === "ACTIVE" ? "archive" : "restore";
    setSaving(true);
    setError(undefined);
    try {
      const context = await browserApiRequest<TrackingContextSummary>(
        `${trackingContextApiPath(projectId, selected.id)}/${action}`,
        { method: "POST", ifMatch: selected.version }
      );
      setSettings((current) =>
        current ? withTrackingContext(current, context) : current
      );
      setDraft(trackingContextDraft(context));
      setNotice(
        context.status === "ACTIVE"
          ? "Контекст восстановлен."
          : "Контекст удалён из новых запусков. История и результаты сохранены."
      );
      setDeleteConfirmationOpen(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить статус контекста."
      );
    } finally {
      setSaving(false);
    }
  }

  async function mergeRankDimensions(): Promise<void> {
    if (
      merging ||
      !settings?.access.canConfigure ||
      !mergeSourceKey ||
      !mergeTargetKey
    ) return;
    setMerging(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const created = await browserApiRequest<RankDimensionMergeSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/dimension-merges`,
        {
          method: "POST",
          idempotencyKey: `rank-dimension-merge:${crypto.randomUUID()}`,
          body: {
            sourceDimensionKey: mergeSourceKey,
            targetDimensionKey: mergeTargetKey
          }
        }
      );
      setRankMergeSettings((current) => current ? {
        ...current,
        merges: [...current.merges, created]
      } : current);
      setMergeSourceKey("");
      setMergeTargetKey("");
      setNotice("Срезы объединены. История и текущие позиции теперь показываются вместе.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось объединить срезы."
      );
    } finally {
      setMerging(false);
    }
  }

  async function removeRankDimensionMerge(
    merge: RankDimensionMergeSummary
  ): Promise<void> {
    if (merging || !settings?.access.canConfigure) return;
    setMerging(true);
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/dimension-merges/${encodeURIComponent(merge.id)}/remove`,
        { method: "POST", body: {}, ifMatch: merge.version }
      );
      setRankMergeSettings((current) => current ? {
        ...current,
        merges: current.merges.filter(({ id }) => id !== merge.id)
      } : current);
      setNotice("Объединение отменено. Исходные снимки снова показаны отдельным срезом.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отменить объединение."
      );
    } finally {
      setMerging(false);
    }
  }

  if (loading) {
    return <section className="panel tracking-context-settings-loading"><UiText text="Загружаем контексты…" /></section>;
  }

  return (
    <>
    <section className="tracking-context-settings">
      <aside className="panel tracking-context-catalog">
        <header>
          <div>
            <span><UiText text="Профили запуска" /></span>
            <h2><UiText text="Контексты" /></h2>
          </div>
          <button aria-label={uiText("Создать контекст")} onClick={startNew} type="button">
            <Icon name="plus" />
          </button>
        </header>
        <div className="tracking-context-catalog-list">
          {settings?.contexts.map((context) => (
            <button
              className={context.id === selectedId ? "selected" : undefined}
              key={context.id}
              onClick={() => choose(context)}
              type="button"
            >
              <SearchEngineLogo engine={context.configuration.searchEngine} size="compact" />
              <span>
                <strong>{trackingContextDisplayName(context)}</strong>
                <small>
                  {context.assignedKeywordCount} <UiText text="запросов ·" before=" " after=" " />{context.status === "ACTIVE" ? <UiText text="активен" /> : <UiText text="удалён из запусков" />}
                </small>
              </span>
            </button>
          ))}
          {settings?.contexts.length === 0 && (
            <p><UiText text="Контекстов пока нет. Создайте первый профиль запуска." /></p>
          )}
        </div>
      </aside>

      <div className="panel tracking-context-editor">
        <header>
          <div>
            <span>{selected ? <UiText text="Редактирование" /> : <UiText text="Новый профиль" />}</span>
            <h2>{selected?.name ?? <UiText text="Новый контекст позиций" />}</h2>
          </div>
          {selected && (
            <span className={`status-badge ${selected.status === "ACTIVE" ? "success" : "neutral"}`}>
              {selected.status === "ACTIVE" ? <UiText text="Активен" /> : <UiText text="Удалён" />}
            </span>
          )}
        </header>

        <div className="tracking-context-form-grid">
          <label className="field-span-2">
            <span><UiText text="Название контекста" /></span>
            <input
              maxLength={160}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              value={draft.name}
            />
          </label>
          <label>
            <span><UiText text="Поисковая система" /></span>
            <CustomSelect
              onChange={(event) =>
                setDraft({
                  ...draft,
                  searchEngine: event.target.value as "YANDEX" | "GOOGLE",
                  searchSource:
                    event.target.value === "GOOGLE" ? "LIVE" : draft.searchSource
                })
              }
              value={draft.searchEngine}
            >
              <option value="YANDEX"><UiText text="Яндекс" /></option>
              <option value="GOOGLE">Google</option>
            </CustomSelect>
          </label>
          <label>
            <span><UiText text="Источник выдачи" /></span>
            <CustomSelect
              onChange={(event) =>
                setDraft({
                  ...draft,
                  searchSource: event.target.value as "LIVE" | "SEARCH_API"
                })
              }
              value={draft.searchSource}
            >
              {draft.searchEngine === "YANDEX" && (
                <option value="SEARCH_API"><UiText text="Яндекс XML / Search API" /></option>
              )}
              <option value="LIVE">
                {draft.searchEngine === "YANDEX" ? <UiText text="Яндекс Live" /> : "Google Live"}
              </option>
            </CustomSelect>
          </label>
          <label className="field-span-2">
            <span><UiText text="Регион" /></span>
            <SearchableRegionSelect
              kind={draft.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
              onChange={({ code, label }) =>
                setDraft({ ...draft, regionCode: code, regionLabel: label })
              }
              value={draft.regionCode}
              valueLabel={draft.regionLabel}
            />
          </label>
          <fieldset>
            <legend><UiText text="Устройство" /></legend>
            <div className="tracking-context-segments">
              {(["DESKTOP", "MOBILE"] as const).map((device) => (
                <button
                  className={draft.device === device ? "selected" : undefined}
                  key={device}
                  onClick={() => setDraft({ ...draft, device })}
                  type="button"
                >
                  {device === "DESKTOP" ? <UiText text="Десктоп" /> : <UiText text="Мобильное" />}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend><UiText text="Глубина" /></legend>
            <div className="tracking-context-segments">
              {([30, 50, 100] as const).map((depth) => (
                <button
                  className={draft.depth === depth ? "selected" : undefined}
                  key={depth}
                  onClick={() => setDraft({ ...draft, depth })}
                  type="button"
                >
                  <UiText text="Топ-" />{depth}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <ContextScopeEditor draft={draft} groups={groups} onChange={setDraft} />
        <label className="semantic-toggle-line tracking-context-untracked-toggle">
          <input
            checked={draft.includeUntracked}
            onChange={(event) => setDraft({
              ...draft,
              includeUntracked: event.target.checked
            })}
            type="checkbox"
          />
          <span>
            <strong><UiText text="Включать неотслеживаемые запросы" /></strong>
            <small>
              <UiText text="По умолчанию такие запросы остаются в контексте, но не попадают в съём позиций." /></small>
          </span>
        </label>

        {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
        {notice && <div className="inline-alert success" role="status">{<UiText text={notice ?? ""} />}</div>}
        {!settings?.access.canConfigure && (
          <div className="inline-alert info"><UiText text="Доступен только просмотр контекстов." /></div>
        )}
        <footer>
          {selected && (
            <button
              className={selected.status === "ACTIVE" ? "secondary-button danger-button" : "secondary-button"}
              disabled={saving || !settings?.access.canConfigure}
              onClick={() => {
                if (selected.status === "ACTIVE") {
                  setError(undefined);
                  setDeleteConfirmationOpen(true);
                } else {
                  void changeStatus();
                }
              }}
              type="button"
            >
              {selected.status === "ACTIVE" ? <UiText text="Удалить контекст" /> : <UiText text="Восстановить" />}
            </button>
          )}
          <button
            className="primary-button"
            disabled={saving || !settings?.access.canConfigure || selected?.status === "ARCHIVED"}
            onClick={() => void save()}
            type="button"
          >
            {saving ? <UiText text="Сохраняем…" /> : selected ? <UiText text="Сохранить" /> : <UiText text="Создать контекст" />}
          </button>
        </footer>
      </div>
    </section>
    <section className="panel tracking-dimension-merges">
      <header>
        <div>
          <span><UiText text="История позиций" /></span>
          <h2><UiText text="Объединение срезов" /></h2>
          <p><UiText text="Склейте импортированный или лишний срез с основным городом и устройством. Исходные снимки сохранятся." /></p>
        </div>
      </header>
      {rankMergeSettings && mergeSources.length > 0 ? (
        <div className="tracking-dimension-merge-form">
          <label>
            <span><UiText text="Что скрыть и присоединить" /></span>
            <CustomSelect
              disabled={merging || !settings?.access.canConfigure}
              onChange={(event) => {
                const sourceKey = event.target.value;
                const source = rankMergeSettings.dimensions.find(
                  ({ key }) => key === sourceKey
                );
                const blockedTargets = new Set(
                  rankMergeSettings.merges.map(({ source }) => source.key)
                );
                const target = source
                  ? rankMergeSettings.dimensions.find((dimension) =>
                      dimension.key !== source.key &&
                      !blockedTargets.has(dimension.key) &&
                      compatibleRankDimensions(source, dimension)
                    )
                  : undefined;
                setMergeSourceKey(sourceKey);
                setMergeTargetKey(target?.key ?? "");
              }}
              searchable
              searchPlaceholder={uiText("Найти город или устройство")}
              value={mergeSourceKey}
            >
              <option value=""><UiText text="Выберите исходный срез" /></option>
              {mergeSources.map((dimension) => (
                <option key={dimension.key} value={dimension.key}>
                  <SemanticRankContext {...dimension} />
                </option>
              ))}
            </CustomSelect>
          </label>
          <label>
            <span><UiText text="К какому срезу присоединить" /></span>
            <CustomSelect
              disabled={merging || !settings?.access.canConfigure || !mergeSourceKey}
              onChange={(event) => setMergeTargetKey(event.target.value)}
              searchable
              searchPlaceholder={uiText("Найти город или устройство")}
              value={mergeTargetKey}
            >
              <option value=""><UiText text="Выберите основной срез" /></option>
              {mergeTargets.map((dimension) => (
                <option key={dimension.key} value={dimension.key}>
                  <SemanticRankContext {...dimension} />
                </option>
              ))}
            </CustomSelect>
          </label>
          <button
            className="primary-button"
            disabled={merging || !settings?.access.canConfigure || !mergeSourceKey || !mergeTargetKey}
            onClick={() => void mergeRankDimensions()}
            type="button"
          >
            {merging ? <><i className="spinner compact" /><UiText text="Объединяем…" /></> : <><Icon name="move" /><UiText text="Объединить срезы" /></>}
          </button>
        </div>
      ) : (
        <p className="tracking-dimension-merge-empty"><UiText text="Для объединения нужны хотя бы два совместимых сохранённых среза." /></p>
      )}
      {rankMergeSettings && rankMergeSettings.merges.length > 0 && (
        <div className="tracking-dimension-merge-list">
          <h3><UiText text="Активные объединения" /></h3>
          {rankMergeSettings.merges.map((merge) => (
            <div key={merge.id}>
              <SemanticRankContext {...merge.source} />
              <Icon name="chevronRight" />
              <SemanticRankContext {...merge.target} />
              <button
                className="text-button"
                disabled={merging || !settings?.access.canConfigure}
                onClick={() => void removeRankDimensionMerge(merge)}
                type="button"
              >
                <UiText text="Разъединить" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
    {deleteConfirmationOpen && selected?.status === "ACTIVE" && (
      <SemanticModal
        className="tracking-context-delete-modal"
        description={uiText("Контекст «{0}» больше нельзя будет выбрать для нового съёма.", [String(selected.name)])}
        footer={
          <>
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setDeleteConfirmationOpen(false)}
              type="button"
            >
              <UiText text="Отмена" /></button>
            <button
              className="danger-button"
              disabled={saving}
              onClick={() => void changeStatus()}
              type="button"
            >
              {saving ? <UiText text="Удаляем…" /> : <UiText text="Удалить контекст" />}
            </button>
          </>
        }
        onClose={() => {
          if (!saving) setDeleteConfirmationOpen(false);
        }}
        size="small"
        style={{
          height: "fit-content",
          margin: "auto",
          maxHeight: "calc(100dvh - 32px)",
          maxWidth: "calc(100vw - 32px)",
          minHeight: 0,
          width: 420
        }}
        title={uiText("Удалить контекст?")}
      >
        <div className="tracking-context-delete-copy">
          <div className="inline-alert info">
            <UiText text="Результаты, история позиций и выполненные операции не удаляются. Контекст останется доступен в истории и его можно будет восстановить." /></div>
          {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
        </div>
      </SemanticModal>
    )}
    </>
  );
}

function ContextScopeEditor({
  draft,
  groups,
  onChange
}: Readonly<{
  draft: TrackingContextDraft;
  groups: readonly ContextGroup[];
  onChange: (draft: TrackingContextDraft) => void;
}>) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(groups.filter(({ parentId }) => !parentId).map(({ id }) => id))
  );
  const rows = useMemo(
    () => contextFolderRows(groups, expandedIds),
    [expandedIds, groups]
  );

  function toggleGroup(groupId: string): void {
    const groupIds = new Set(draft.groupIds);
    if (groupIds.has(groupId)) groupIds.delete(groupId);
    else groupIds.add(groupId);
    onChange({ ...draft, scopeMode: "GROUPS", groupIds: [...groupIds] });
  }

  return (
    <section className="tracking-context-scope-editor">
      <header>
        <div>
          <h3><UiText text="Охват контекста" /></h3>
          <p><UiText text="Родительская папка автоматически включает все вложенные папки." /></p>
        </div>
        <div className="tracking-context-segments">
          <button
            className={draft.scopeMode === "ALL" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "ALL", groupIds: [] })}
            type="button"
          >
            <UiText text="Весь проект" /></button>
          <button
            className={draft.scopeMode === "GROUPS" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "GROUPS" })}
            type="button"
          >
            <UiText text="Папки" /></button>
          <button
            className={draft.scopeMode === "KEYWORDS" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "KEYWORDS", groupIds: [] })}
            type="button"
          >
            <UiText text="Запросы" /></button>
        </div>
      </header>
      {draft.scopeMode === "GROUPS" ? (
        <div className="tracking-context-folder-tree">
          {rows.map(({ group, depth, hasChildren }) => (
            <div
              key={group.id}
              style={{ "--folder-depth": depth } as CSSProperties}
            >
              {hasChildren ? (
                <button
                  aria-expanded={expandedIds.has(group.id)}
                  className="tracking-context-folder-toggle"
                  onClick={() =>
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
              ) : (
                <span />
              )}
              <label>
                <input
                  checked={draft.groupIds.includes(group.id)}
                  onChange={() => toggleGroup(group.id)}
                  type="checkbox"
                />
                <Icon name="projects" />
                <strong>{group.name}</strong>
                <small>{group.keywordCount}</small>
              </label>
            </div>
          ))}
        </div>
      ) : (
        <div className="tracking-context-scope-note">
          {draft.scopeMode === "ALL"
            ? <UiText text="При каждом запуске будут выбраны все активные запросы проекта." />
            : <UiText text="Точный список запросов задаётся в окне запуска и сохраняется после успешной подготовки." />}
        </div>
      )}
    </section>
  );
}

function contextFolderRows(
  groups: readonly ContextGroup[],
  expandedIds: ReadonlySet<string>
): readonly Readonly<{
  group: ContextGroup;
  depth: number;
  hasChildren: boolean;
}>[] {
  const usable = groups.filter(({ systemKind }) => systemKind !== "TRASH");
  const ids = new Set(usable.map(({ id }) => id));
  const byParent = new Map<string | undefined, ContextGroup[]>();
  for (const group of usable) {
    const parent = group.parentId && ids.has(group.parentId) ? group.parentId : undefined;
    const current = byParent.get(parent) ?? [];
    current.push(group);
    byParent.set(parent, current);
  }
  const result: Array<{ group: ContextGroup; depth: number; hasChildren: boolean }> = [];
  const visited = new Set<string>();
  const append = (parentId: string | undefined, depth: number): void => {
    for (const group of byParent.get(parentId) ?? []) {
      if (visited.has(group.id)) continue;
      visited.add(group.id);
      const hasChildren = Boolean(byParent.get(group.id)?.length);
      result.push({ group, depth, hasChildren });
      if (hasChildren && expandedIds.has(group.id)) append(group.id, depth + 1);
    }
  };
  append(undefined, 0);
  return result;
}

function compatibleRankDimensions(
  source: SemanticRankDimension,
  target: SemanticRankDimension
): boolean {
  return source.searchEngine === target.searchEngine &&
    source.countryCode === target.countryCode &&
    source.language === target.language &&
    source.device === target.device;
}
