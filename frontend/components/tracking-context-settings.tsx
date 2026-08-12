"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import {
  defaultTrackingContextSettingsDraft,
  trackingContextApiPath,
  trackingContextCreateInput,
  trackingContextDraft,
  validateTrackingContextDraft,
  withTrackingContext,
  type TrackingContextDraft
} from "../lib/tracking-contexts";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SemanticModal } from "./semantic-modal";

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
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [groups, setGroups] = useState<readonly ContextGroup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(defaultTrackingContextSettingsDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selected = settings?.contexts.find(({ id }) => id === selectedId);

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
      )
    ])
      .then(([contextSettings, contextGroups]) => {
        if (controller.signal.aborted) return;
        setSettings(contextSettings);
        setGroups(
          contextGroups.filter(({ systemKind }) => systemKind !== "TRASH")
        );
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

  if (loading) {
    return <section className="panel tracking-context-settings-loading">Загружаем контексты…</section>;
  }

  return (
    <>
    <section className="tracking-context-settings">
      <aside className="panel tracking-context-catalog">
        <header>
          <div>
            <span>Профили запуска</span>
            <h2>Контексты</h2>
          </div>
          <button aria-label="Создать контекст" onClick={startNew} type="button">
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
                <strong>{context.name}</strong>
                <small>
                  {context.assignedKeywordCount} запросов · {context.status === "ACTIVE" ? "активен" : "удалён из запусков"}
                </small>
              </span>
            </button>
          ))}
          {settings?.contexts.length === 0 && (
            <p>Контекстов пока нет. Создайте первый профиль запуска.</p>
          )}
        </div>
      </aside>

      <div className="panel tracking-context-editor">
        <header>
          <div>
            <span>{selected ? "Редактирование" : "Новый профиль"}</span>
            <h2>{selected?.name ?? "Новый контекст позиций"}</h2>
          </div>
          {selected && (
            <span className={`status-badge ${selected.status === "ACTIVE" ? "success" : "neutral"}`}>
              {selected.status === "ACTIVE" ? "Активен" : "Удалён"}
            </span>
          )}
        </header>

        <div className="tracking-context-form-grid">
          <label className="field-span-2">
            <span>Название контекста</span>
            <input
              maxLength={160}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              value={draft.name}
            />
          </label>
          <label>
            <span>Поисковая система</span>
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
              <option value="YANDEX">Яндекс</option>
              <option value="GOOGLE">Google</option>
            </CustomSelect>
          </label>
          <label>
            <span>Источник выдачи</span>
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
                <option value="SEARCH_API">Яндекс XML / Search API</option>
              )}
              <option value="LIVE">
                {draft.searchEngine === "YANDEX" ? "Яндекс Live" : "Google Live"}
              </option>
            </CustomSelect>
          </label>
          <label className="field-span-2">
            <span>Регион</span>
            <SearchableRegionSelect
              kind={draft.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
              onChange={({ code, label }) =>
                setDraft({ ...draft, regionCode: code, regionLabel: label })
              }
              value={draft.regionCode}
            />
          </label>
          <fieldset>
            <legend>Устройство</legend>
            <div className="tracking-context-segments">
              {(["DESKTOP", "MOBILE"] as const).map((device) => (
                <button
                  className={draft.device === device ? "selected" : undefined}
                  key={device}
                  onClick={() => setDraft({ ...draft, device })}
                  type="button"
                >
                  {device === "DESKTOP" ? "Десктоп" : "Мобильное"}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Глубина</legend>
            <div className="tracking-context-segments">
              {([30, 50, 100] as const).map((depth) => (
                <button
                  className={draft.depth === depth ? "selected" : undefined}
                  key={depth}
                  onClick={() => setDraft({ ...draft, depth })}
                  type="button"
                >
                  Топ-{depth}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <ContextScopeEditor draft={draft} groups={groups} onChange={setDraft} />

        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        {notice && <div className="inline-alert success" role="status">{notice}</div>}
        {!settings?.access.canConfigure && (
          <div className="inline-alert info">Доступен только просмотр контекстов.</div>
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
              {selected.status === "ACTIVE" ? "Удалить контекст" : "Восстановить"}
            </button>
          )}
          <button
            className="primary-button"
            disabled={saving || !settings?.access.canConfigure || selected?.status === "ARCHIVED"}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "Сохраняем…" : selected ? "Сохранить" : "Создать контекст"}
          </button>
        </footer>
      </div>
    </section>
    {deleteConfirmationOpen && selected?.status === "ACTIVE" && (
      <SemanticModal
        className="tracking-context-delete-modal"
        description={`Контекст «${selected.name}» больше нельзя будет выбрать для нового съёма.`}
        footer={
          <>
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setDeleteConfirmationOpen(false)}
              type="button"
            >
              Отмена
            </button>
            <button
              className="danger-button"
              disabled={saving}
              onClick={() => void changeStatus()}
              type="button"
            >
              {saving ? "Удаляем…" : "Удалить контекст"}
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
        title="Удалить контекст?"
      >
        <div className="tracking-context-delete-copy">
          <div className="inline-alert info">
            Результаты, история позиций и выполненные операции не удаляются.
            Контекст останется доступен в истории и его можно будет восстановить.
          </div>
          {error && <div className="inline-alert danger" role="alert">{error}</div>}
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
          <h3>Охват контекста</h3>
          <p>Родительская папка автоматически включает все вложенные папки.</p>
        </div>
        <div className="tracking-context-segments">
          <button
            className={draft.scopeMode === "ALL" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "ALL", groupIds: [] })}
            type="button"
          >
            Весь проект
          </button>
          <button
            className={draft.scopeMode === "GROUPS" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "GROUPS" })}
            type="button"
          >
            Папки
          </button>
          <button
            className={draft.scopeMode === "KEYWORDS" ? "selected" : undefined}
            onClick={() => onChange({ ...draft, scopeMode: "KEYWORDS", groupIds: [] })}
            type="button"
          >
            Запросы
          </button>
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
            ? "При каждом запуске будут выбраны все активные запросы проекта."
            : "Точный список запросов задаётся в окне запуска и сохраняется после успешной подготовки."}
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
