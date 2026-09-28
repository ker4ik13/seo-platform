"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  parseRankDimensionMergeSettings,
  type RankDimensionMergeSettings,
  type RankDimensionMergeSummary,
  type SemanticRankDimension,
  type TrackingContextKeywordReplacementResult,
  type TrackingContextSettings,
  type TrackingContextSummary
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { defaultSemanticSearchRegions } from "../lib/semantic-region-preference";
import {
  rankTargetDraft,
  uniqueRankTargets,
  type RankTarget
} from "../lib/rank-targets";
import {
  announceTrackingContextsChanged,
  defaultTrackingContextSettingsDraft,
  trackingContextApiPath,
  trackingContextCreateInput,
  trackingContextDisplayName,
  trackingContextDraft,
  trackingContextMatchesDraft,
  validateTrackingContextDraft,
  withTrackingContext,
  type TrackingContextDraft
} from "../lib/tracking-contexts";
import { resolvedFolderSelectionIds } from "../lib/semantic-operation-tree";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { InfoTooltip } from "./info-tooltip";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticRankTargets } from "./semantic-rank-targets";
import { SemanticRankContext } from "./semantic-rank-context";
import { SemanticModal } from "./semantic-modal";
import { SemanticFolderDescendantsToggle } from "./semantic-folder-descendants-toggle";
import { UiText, useUiLocale } from "./ui-locale";


interface ContextGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

export function TrackingContextSettingsPanel({
  projectId
}: Readonly<{ projectId: string }>) {
  const { t: uiText, locale: uiLocale } = useUiLocale();
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [rankMergeSettings, setRankMergeSettings] =
    useState<RankDimensionMergeSettings>();
  const [mergeSourceKey, setMergeSourceKey] = useState("");
  const [mergeTargetKey, setMergeTargetKey] = useState("");
  const [merging, setMerging] = useState(false);
  const [groups, setGroups] = useState<readonly ContextGroup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(defaultTrackingContextSettingsDraft);
  const [targets, setTargets] = useState<readonly RankTarget[]>(() => [
    trackingContextTarget(defaultTrackingContextSettingsDraft())
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const loadedProject = useRef("");
  const materializedProject = useRef("");
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
    loadedProject.current = "";
    materializedProject.current = "";
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
        loadedProject.current = projectId;
        const availableGroups = contextGroups.filter(
          ({ systemKind }) => systemKind !== "TRASH"
        );
        setSettings(contextSettings);
        setGroups(availableGroups);
        setRankMergeSettings(mergeSettings);
        const first = contextSettings.contexts.find(
          ({ status }) => status === "ACTIVE"
        );
        if (first) {
          const firstDraft = editableTrackingContextDraft(
            first,
            availableGroups
          );
          setSelectedId(first.id);
          setDraft(firstDraft);
          setTargets([trackingContextTarget(firstDraft)]);
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

  useEffect(() => {
    if (
      loading ||
      loadedProject.current !== projectId ||
      !settings?.access.canConfigure ||
      materializedProject.current === projectId
    ) return;
    materializedProject.current = projectId;
    const controller = new AbortController();
    setRecalculating(true);
    void materializeTrackingContexts(
      projectId,
      settings.contexts,
      controller.signal
    )
      .then((contexts) => {
        if (controller.signal.aborted) return;
        const byId = new Map(contexts.map((context) => [context.id, context]));
        setSettings((current) => current ? {
          ...current,
          contexts: current.contexts.map((context) =>
            byId.get(context.id) ?? context
          )
        } : current);
        announceTrackingContextsChanged();
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          materializedProject.current = "";
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Не удалось пересчитать запросы контекстов."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecalculating(false);
      });
    return () => controller.abort();
  }, [loading, projectId, settings?.access.canConfigure, settings?.contexts]);

  function choose(context: TrackingContextSummary): void {
    const nextDraft = editableTrackingContextDraft(context, groups);
    setSelectedId(context.id);
    setDraft(nextDraft);
    setTargets([trackingContextTarget(nextDraft)]);
    setDeleteConfirmationOpen(false);
    setError(undefined);
    setNotice(undefined);
  }

  function startNew(): void {
    const nextDraft = defaultTrackingContextSettingsDraft();
    setSelectedId("");
    setDraft(nextDraft);
    setTargets([trackingContextTarget(nextDraft)]);
    setDeleteConfirmationOpen(false);
    setError(undefined);
    setNotice(undefined);
  }

  function changeTargets(nextTargets: readonly RankTarget[]): void {
    const normalized = uniqueRankTargets(nextTargets);
    const first = normalized[0]!;
    setTargets(normalized);
    setDraft((current) => ({ ...current, ...first }));
  }

  function changeSearchEngine(searchEngine: "YANDEX" | "GOOGLE"): void {
    const region = defaultSemanticSearchRegions()[searchEngine];
    const device = targets[0]?.device ?? "DESKTOP";
    const nextTarget = {
      regionCode: region.code,
      regionLabel: region.label,
      device
    } satisfies RankTarget;
    setTargets([nextTarget]);
    setDraft((current) => ({
      ...current,
      ...nextTarget,
      searchEngine,
      searchSource: searchEngine === "GOOGLE" ? "LIVE" : current.searchSource
    }));
  }

  async function save(): Promise<void> {
    if (saving || recalculating || !settings?.access.canConfigure) return;
    if (!draft.name.trim()) {
      setError("Введите название контекста.");
      return;
    }
    const normalizedTargets = uniqueRankTargets(targets);
    const targetDrafts = normalizedTargets.map((target, index) => {
      const targetDraft = rankTargetDraft(draft, target, false, uiLocale);
      return {
        ...targetDraft,
        name:
          normalizedTargets.length === 1 || (selected && index === 0)
            ? draft.name
            : `${draft.name.trim()} · ${targetDraft.name}`.slice(0, 160)
      };
    });
    const firstError = targetDrafts
      .flatMap((targetDraft) =>
        Object.values(validateTrackingContextDraft(targetDraft))
      )[0];
    if (firstError) {
      setError(firstError);
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved: TrackingContextSummary[] = [];
      for (const [index, targetDraft] of targetDrafts.entries()) {
        const savedContext = selected && index === 0
          ? await updateTrackingContext(
              projectId,
              selected,
              targetDraft
            )
          : await browserApiRequest<TrackingContextSummary>(
              `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
              {
                method: "POST",
                idempotencyKey: `tracking-context-settings:${crypto.randomUUID()}`,
                body: trackingContextCreateInput(targetDraft)
              }
            );
        const materialized = await materializeTrackingContext(
          projectId,
          savedContext
        );
        const context = {
          ...savedContext,
          assignedKeywordCount: materialized.assignedKeywordCount,
          version: materialized.version
        };
        saved.push(context);
        setSettings((current) =>
          current ? withTrackingContext(current, context) : current
        );
      }
      const primary = saved[0]!;
      const primaryDraft = editableTrackingContextDraft(primary, groups);
      setSelectedId(primary.id);
      setDraft(primaryDraft);
      setTargets([trackingContextTarget(primaryDraft)]);
      setNotice(selected
        ? targetDrafts.length === 1
          ? "Контекст обновлён."
          : uiText("Контекст обновлён и создано дополнительных профилей: {0}.", [String(targetDrafts.length - 1)])
        : targetDrafts.length === 1
          ? "Контекст создан."
          : uiText("Создано профилей: {0}.", [String(targetDrafts.length)]));
      announceTrackingContextsChanged();
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

  async function deleteContext(): Promise<void> {
    if (!selected || saving || recalculating || !settings?.access.canConfigure) return;
    setSaving(true);
    setError(undefined);
    try {
      const context = await archiveTrackingContext(projectId, selected);
      const remaining = settings.contexts.filter(({ id }) => id !== context.id);
      const next = remaining[0];
      setSettings({ ...settings, contexts: remaining });
      setSelectedId(next?.id ?? "");
      const nextDraft = next
        ? editableTrackingContextDraft(next, groups)
        : defaultTrackingContextSettingsDraft();
      setDraft(nextDraft);
      setTargets([trackingContextTarget(nextDraft)]);
      setNotice("Контекст удалён из профилей запуска. История и результаты сохранены.");
      announceTrackingContextsChanged();
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
            {recalculating && <small role="status"><UiText text="Пересчитываем запросы…" /></small>}
          </div>
          <button aria-label={uiText("Создать контекст")} onClick={startNew} type="button">
            <Icon name="plus" />
          </button>
        </header>
        <div className="tracking-context-catalog-list">
          {settings?.contexts
            .filter(({ status }) => status === "ACTIVE")
            .map((context) => (
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
                  {context.assignedKeywordCount} <UiText text="запросов · активен" before=" " />
                </small>
              </span>
            </button>
          ))}
          {settings?.contexts.filter(({ status }) => status === "ACTIVE").length === 0 && (
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
          {selected && <span className="status-badge success"><UiText text="Активен" /></span>}
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
          <fieldset className="tracking-context-engine-field">
            <legend><UiText text="Поисковая система" /></legend>
            <div className="tracking-context-engine-options">
              {(["YANDEX", "GOOGLE"] as const).map((engine) => (
                <button
                  aria-pressed={draft.searchEngine === engine}
                  className={draft.searchEngine === engine ? "selected" : undefined}
                  key={engine}
                  onClick={() => changeSearchEngine(engine)}
                  type="button"
                >
                  <SearchEngineLogo engine={engine} size="compact" />
                  <span>{engine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span><UiText text="Источник выдачи" /></span>
            <CustomSelect
              onChange={(event) =>
                setDraft({
                  ...draft,
                  searchSource: event.target.value as "LIVE" | "SEARCH_API",
                  ...(event.target.value === "SEARCH_API" && draft.depth === 10
                    ? {
                        depth: 30 as const,
                        yandexLiveMode: "STANDARD" as const
                      }
                    : {})
                })
              }
              value={draft.searchSource}
            >
              {draft.searchEngine === "YANDEX" && (
                <option value="SEARCH_API"><UiText text="Яндекс XML / Search API" /></option>
              )}
              <option value="LIVE">
                {draft.searchEngine === "YANDEX" ? <UiText text="Яндекс Live" /> : "Google XML"}
              </option>
            </CustomSelect>
          </label>
          <div className="field-span-2 tracking-context-targets-field">
            <SemanticRankTargets
              engine={draft.searchEngine}
              onChange={changeTargets}
              targets={targets}
            />
          </div>
          <fieldset className="field-span-2 tracking-context-depth-field">
            <legend><UiText text="Глубина" /></legend>
            <div className="tracking-context-segments">
              {(draft.searchSource === "LIVE"
                ? [10, 30, 50, 100] as const
                : [30, 50, 100] as const).map((depth) => (
                <button
                  className={draft.depth === depth ? "selected" : undefined}
                  key={depth}
                  onClick={() => setDraft({
                    ...draft,
                    depth,
                    ...(depth === 10
                      ? { yandexLiveMode: "STANDARD" as const }
                      : {})
                  })}
                  type="button"
                >
                  <UiText text="Топ-" />{depth}
                </button>
              ))}
            </div>
          </fieldset>
          {draft.searchSource === "LIVE" && (
            <fieldset className="field-span-2 semantic-segmented-field semantic-xmlstock-depth-mode">
              <legend>
                <UiText text="Обход выдачи XMLStock" />
                <InfoTooltip>
                  <UiText text="Настройка сохраняется в контексте и применяется при следующем запуске через XMLStock." />
                </InfoTooltip>
              </legend>
              <div
                aria-label={uiText("Обход выдачи XMLStock")}
                className="semantic-segmented-control"
                role="radiogroup"
              >
                <label className={draft.xmlStockDepthMode === "STOP_AFTER_FOUND" ? "selected" : undefined}>
                  <input
                    checked={draft.xmlStockDepthMode === "STOP_AFTER_FOUND"}
                    name="tracking-context-xmlstock-depth-mode"
                    onChange={() => setDraft({
                      ...draft,
                      xmlStockDepthMode: "STOP_AFTER_FOUND"
                    })}
                    type="radio"
                  />
                  <span><UiText text="До первой позиции" /></span>
                </label>
                <label className={draft.xmlStockDepthMode === "STRICT_DEPTH" ? "selected" : undefined}>
                  <input
                    checked={draft.xmlStockDepthMode === "STRICT_DEPTH"}
                    name="tracking-context-xmlstock-depth-mode"
                    onChange={() => setDraft({
                      ...draft,
                      xmlStockDepthMode: "STRICT_DEPTH"
                    })}
                    type="radio"
                  />
                  <span><UiText text="Строго выбранный Топ" /></span>
                </label>
              </div>
            </fieldset>
          )}
          {draft.searchEngine === "YANDEX" &&
          draft.searchSource === "LIVE" &&
          draft.depth !== 10 && (
            <label className="field-span-2 semantic-toggle-line tracking-context-turbo-toggle">
              <input
                checked={draft.yandexLiveMode === "TURBO"}
                onChange={(event) => setDraft({
                  ...draft,
                  yandexLiveMode: event.target.checked ? "TURBO" : "STANDARD"
                })}
                type="checkbox"
              />
              <span>
                <strong>
                  <UiText text="Turbo режим XMLStock" />
                  <InfoTooltip>
                    <UiText text="Настройка сохраняется в контексте: Turbo запрашивает до 50 результатов на страницу и автоматически дочитывает недостающие страницы." />
                  </InfoTooltip>
                </strong>
                <small><UiText text="Использовать Turbo для будущих запусков этого контекста через XMLStock." /></small>
              </span>
            </label>
          )}
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
              className="secondary-button danger-button"
              disabled={saving || recalculating || !settings?.access.canConfigure}
              onClick={() => {
                setError(undefined);
                setDeleteConfirmationOpen(true);
              }}
              type="button"
            >
              <UiText text="Удалить контекст" />
            </button>
          )}
          <button
            className="primary-button"
            disabled={saving || recalculating || !settings?.access.canConfigure}
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
    {deleteConfirmationOpen && selected && (
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
              onClick={() => void deleteContext()}
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
            <UiText text="Результаты, история позиций и выполненные операции не удаляются. Профиль исчезнет из настроек и новых запусков." /></div>
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
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind !== "TRASH"),
    [groups]
  );
  const includedGroupIds = useMemo(
    () => new Set(
      resolvedFolderSelectionIds(
        availableGroups,
        new Set(draft.groupIds),
        new Set(draft.descendantGroupIds)
      )
    ),
    [availableGroups, draft.descendantGroupIds, draft.groupIds]
  );
  useEffect(() => {
    if (draft.groupIds.length === 0 && draft.descendantGroupIds.length > 0) {
      onChange({ ...draft, descendantGroupIds: [] });
    }
  }, [draft, onChange]);

  function toggleGroup(groupId: string): void {
    const groupIds = new Set(draft.groupIds);
    const descendantGroupIds = new Set(draft.descendantGroupIds);
    if (groupIds.has(groupId)) {
      groupIds.delete(groupId);
      descendantGroupIds.delete(groupId);
    } else groupIds.add(groupId);
    onChange({
      ...draft,
      scopeMode: "GROUPS",
      groupIds: [...groupIds],
      descendantGroupIds: [...descendantGroupIds]
    });
  }

  function toggleDescendants(groupId: string): void {
    const groupIds = new Set([...draft.groupIds, groupId]);
    const descendantGroupIds = new Set(draft.descendantGroupIds);
    if (descendantGroupIds.has(groupId)) descendantGroupIds.delete(groupId);
    else descendantGroupIds.add(groupId);
    onChange({
      ...draft,
      scopeMode: "GROUPS",
      groupIds: [...groupIds],
      descendantGroupIds: [...descendantGroupIds]
    });
  }

  return (
    <section className="tracking-context-scope-editor">
      <header>
        <div>
          <h3><UiText text="Охват контекста" /></h3>
          <p><UiText text="Обычный выбор включает только запросы самой папки; кнопка справа добавляет её поддерево." /></p>
        </div>
        <div className="tracking-context-segments">
          <button
            className={draft.scopeMode === "ALL" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "ALL", groupIds: [], descendantGroupIds: [] })}
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
            onClick={() => onChange({ ...draft, scopeMode: "KEYWORDS", groupIds: [], descendantGroupIds: [] })}
            type="button"
          >
            <UiText text="Запросы" /></button>
        </div>
      </header>
      {draft.scopeMode === "GROUPS" ? (
        <div className="tracking-context-folder-picker">
          <div className="semantic-operation-folder-options">
            <span><UiText text="Выбрано папок:" after=" " />{includedGroupIds.size}</span>
          </div>
          <div className="tracking-context-folder-tree">
            {rows.map(({ group, depth, hasChildren }) => {
              const selected = draft.groupIds.includes(group.id);
              const includedByParent = !selected && includedGroupIds.has(group.id);
              return (
                <div
                  className={`semantic-operation-folder-row${includedByParent ? " included-by-parent" : ""}`}
                  key={group.id}
                  style={{ "--folder-depth": depth } as CSSProperties}
                >
                  {hasChildren ? (
                    <button
                      aria-expanded={expandedIds.has(group.id)}
                      className="semantic-operation-folder-toggle"
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
                    <span className="semantic-operation-folder-toggle-spacer" />
                  )}
                  <label>
                    <input
                      checked={selected || includedByParent}
                      disabled={includedByParent}
                      onChange={() => toggleGroup(group.id)}
                      type="checkbox"
                    />
                    <i
                      aria-hidden="true"
                      className="semantic-operation-folder-color"
                      style={{ background: group.color ?? "#a8a5b8" }}
                    />
                    <span>{group.name}</span>
                    <b>{group.keywordCount}</b>
                  </label>
                  {hasChildren ? (
                    <SemanticFolderDescendantsToggle
                      disabled={includedByParent}
                      enabled={draft.descendantGroupIds.includes(group.id)}
                      folderName={group.name}
                      onChange={() => toggleDescendants(group.id)}
                    />
                  ) : (
                    <span className="semantic-folder-descendants-spacer" />
                  )}
                </div>
              );
            })}
          </div>
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

function trackingContextTarget(draft: TrackingContextDraft): RankTarget {
  return {
    regionCode: draft.regionCode,
    regionLabel: draft.regionLabel,
    device: draft.device
  };
}

function editableTrackingContextDraft(
  context: TrackingContextSummary,
  groups: readonly ContextGroup[]
): TrackingContextDraft {
  const draft = trackingContextDraft(context);
  if (draft.scopeMode !== "GROUPS") return draft;
  const available = new Set(groups.map(({ id }) => id));
  return {
    ...draft,
    groupIds: draft.groupIds.filter((groupId) => available.has(groupId)),
    descendantGroupIds: draft.descendantGroupIds.filter((groupId) =>
      available.has(groupId)
    )
  };
}

async function updateTrackingContext(
  projectId: string,
  base: TrackingContextSummary,
  draft: TrackingContextDraft
): Promise<TrackingContextSummary> {
  const baseDraft = trackingContextDraft(base);
  const currentRevision = async (): Promise<TrackingContextSummary> => {
    const current = await browserApiRequest<TrackingContextSummary>(
      trackingContextApiPath(projectId, base.id)
    );
    if (
      current.status !== "ACTIVE" ||
      !trackingContextMatchesDraft(current, baseDraft)
    ) {
      throw new Error(
        "Контекст изменён в другой вкладке. Обновите страницу и проверьте новые настройки."
      );
    }
    return current;
  };
  let revision = await currentRevision();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await browserApiRequest<TrackingContextSummary>(
        trackingContextApiPath(projectId, base.id),
        {
          method: "PATCH",
          ifMatch: revision.version,
          body: trackingContextCreateInput(draft)
        }
      );
    } catch (error) {
      if (!(error instanceof BrowserApiError) || error.status !== 412) {
        throw error;
      }
      revision = await currentRevision();
    }
  }
  throw new Error(
    "Контекст обновляется параллельно. Повторите сохранение через несколько секунд."
  );
}

async function archiveTrackingContext(
  projectId: string,
  base: TrackingContextSummary
): Promise<TrackingContextSummary> {
  let revision = await browserApiRequest<TrackingContextSummary>(
    trackingContextApiPath(projectId, base.id)
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (revision.status === "ARCHIVED") return revision;
    try {
      return await browserApiRequest<TrackingContextSummary>(
        `${trackingContextApiPath(projectId, base.id)}/archive`,
        { method: "POST", ifMatch: revision.version }
      );
    } catch (error) {
      if (!(error instanceof BrowserApiError) || error.status !== 412) {
        throw error;
      }
      revision = await browserApiRequest<TrackingContextSummary>(
        trackingContextApiPath(projectId, base.id)
      );
    }
  }
  throw new Error(
    "Контекст обновляется параллельно. Повторите удаление через несколько секунд."
  );
}

async function materializeTrackingContext(
  projectId: string,
  context: TrackingContextSummary,
  signal?: AbortSignal
): Promise<TrackingContextKeywordReplacementResult> {
  return browserApiRequest<TrackingContextKeywordReplacementResult>(
    `${trackingContextApiPath(projectId, context.id)}/materialize`,
    {
      method: "POST",
      body: {},
      ...(signal ? { signal } : {})
    }
  );
}

async function materializeTrackingContexts(
  projectId: string,
  contexts: readonly TrackingContextSummary[],
  signal: AbortSignal
): Promise<readonly TrackingContextSummary[]> {
  const refreshed: TrackingContextSummary[] = [];
  for (let offset = 0; offset < contexts.length; offset += 4) {
    const chunk = contexts.slice(offset, offset + 4);
    const results = await Promise.all(
      chunk.map(async (context) => {
        const result = await materializeTrackingContext(
          projectId,
          context,
          signal
        );
        return {
          ...context,
          assignedKeywordCount: result.assignedKeywordCount,
          version: result.version
        };
      })
    );
    refreshed.push(...results);
  }
  return refreshed;
}
