"use client";

import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";

import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { semanticSavedViewConfigForPersistence } from "../lib/semantic-layout-preferences";
import type {
  SemanticSavedView,
  SemanticViewConfig
} from "./semantic-view-types";
import { isInternalSemanticViewName } from "./semantic-view-types";
import { UiText, useUiLocale } from "./ui-locale";


interface SemanticSavedViewsProps {
  readonly activeView: SemanticSavedView | undefined;
  readonly canManageShared: boolean;
  readonly config: SemanticViewConfig;
  readonly currentUserId: string;
  readonly embedded?: boolean;
  readonly isActiveViewDirty: boolean;
  readonly projectId: string;
  readonly onApply: (view: SemanticSavedView) => void;
  readonly onActiveViewChange: (view?: SemanticSavedView) => void;
}

export function SemanticSavedViews({
  activeView,
  canManageShared,
  config,
  currentUserId,
  embedded = false,
  isActiveViewDirty,
  projectId,
  onApply,
  onActiveViewChange
}: SemanticSavedViewsProps) {
  const { t: uiText } = useUiLocale();
  const [views, setViews] = useState<readonly SemanticSavedView[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"PRIVATE" | "PROJECT_SHARED">(
    "PRIVATE"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const visibleViews = views.filter(
    ({ name: viewName }) => !isInternalSemanticViewName(viewName)
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<readonly SemanticSavedView[]>(
      savedViewUrl(projectId),
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setViews(result);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(savedViewError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!activeView) return;
    setViews((current) => current.map((view) =>
      view.id === activeView.id ? activeView : view
    ));
  }, [activeView]);

  async function createView(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const persistedConfig = semanticSavedViewConfigForPersistence(config);
      const created = await browserApiRequest<SemanticSavedView>(
        savedViewUrl(projectId),
        {
          method: "POST",
          body: { name, scope, config: persistedConfig }
        }
      );
      setViews((current) =>
        [...current, created].sort((left, right) =>
          left.name.localeCompare(right.name, "ru")
        )
      );
      setName("");
      onApply(created);
    } catch (requestError) {
      setError(savedViewError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function replaceView(view: SemanticSavedView): Promise<void> {
    setSaving(true);
    setError(undefined);
    try {
      const persistedConfig = semanticSavedViewConfigForPersistence(config);
      const updated = await browserApiRequest<SemanticSavedView>(
        savedViewUrl(projectId, view.id),
        {
          method: "PATCH",
          body: { config: persistedConfig },
          ifMatch: view.version
        }
      );
      setViews((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      if (activeView?.id === updated.id) onActiveViewChange(updated);
    } catch (requestError) {
      setError(savedViewError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteView(view: SemanticSavedView): Promise<void> {
    if (!window.confirm(`Удалить представление «${view.name}»?`)) return;
    setSaving(true);
    setError(undefined);
    try {
      await browserApiRequest<void>(savedViewUrl(projectId, view.id), {
        method: "DELETE",
        ifMatch: view.version
      });
      const remaining = views.filter(({ id }) => id !== view.id);
      setViews(remaining);
      if (activeView?.id === view.id) {
        const sharedFallback = remaining.find(
          ({ name, scope: viewScope }) =>
            !isInternalSemanticViewName(name) && viewScope === "PROJECT_SHARED"
        );
        if (sharedFallback) onApply(sharedFallback);
        else onActiveViewChange(undefined);
      }
    } catch (requestError) {
      setError(savedViewError(requestError));
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <div className="semantic-saved-views-body">
        {visibleViews.length === 0 && !loading ? (
          <p><UiText text="Сохранённых представлений пока нет." /></p>
        ) : (
          <ul>
            {visibleViews.map((view) => (
              <li key={view.id}>
                <button
                  aria-label={uiText("Применить представление «{0}»", [String(view.name)])}
                  aria-pressed={activeView?.id === view.id}
                  className="semantic-view-apply"
                  disabled={saving}
                  onClick={() => onApply(view)}
                  title={activeView?.id === view.id ? uiText("Представление применено") : uiText("Применить представление")}
                  type="button"
                >
                  <Icon name="checkDouble" />
                </button>
                <button
                  className={`semantic-view-name ${activeView?.id === view.id ? "active" : ""}`}
                  onClick={() => onApply(view)}
                  type="button"
                >
                  <strong>{view.name}</strong>
                  <small>
                    {view.scope === "PRIVATE" ? <UiText text="Личное" /> : <UiText text="Общее" />}
                  </small>
                  {activeView?.id === view.id && isActiveViewDirty && (
                    <small className="semantic-view-dirty"><UiText text="Изменения не сохранены" /></small>
                  )}
                </button>
                {((view.scope === "PRIVATE" && view.ownerId === currentUserId) ||
                  (view.scope === "PROJECT_SHARED" && canManageShared)) && (
                  <>
                    <button
                      className="text-button"
                      disabled={saving}
                      onClick={() => void replaceView(view)}
                      title={uiText("Заменить настройки представления текущими")}
                      type="button"
                    >
                      <UiText text="Обновить" /></button>
                    <button
                      className="text-button danger-text"
                      disabled={saving}
                      onClick={() => void deleteView(view)}
                      type="button"
                    >
                      <UiText text="Удалить" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(event) => void createView(event)}>
          <label>
            <span className="visually-hidden"><UiText text="Название представления" /></span>
            <input
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder={uiText("Название представления")}
              required
              value={name}
            />
          </label>
          {canManageShared ? (
            <CustomSelect
              aria-label={uiText("Доступ к представлению")}
              onChange={(event) =>
                setScope(event.target.value as typeof scope)
              }
              value={scope}
            >
              <option value="PRIVATE"><UiText text="Личное" /></option>
              <option value="PROJECT_SHARED"><UiText text="Общее для проекта" /></option>
            </CustomSelect>
          ) : (
            <span className="semantic-view-private-scope"><UiText text="Личное" /></span>
          )}
          <button className="secondary-button" disabled={saving} type="submit">
            {saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить вид" />}
          </button>
        </form>
        {error && (
          <div className="inline-alert danger" role="alert">
            {<UiText text={error ?? ""} />}
          </div>
        )}
    </div>
  );
  if (embedded) {
    return (
      <section className="semantic-saved-views embedded">
        <header><strong><UiText text="Сохранённые представления" /></strong><span>{loading ? "…" : visibleViews.length}</span></header>
        {body}
      </section>
    );
  }
  return (
    <details className="semantic-saved-views" data-exclusive-dropdown>
      <summary><UiText text="Представления" /><span>{loading ? "…" : visibleViews.length}</span></summary>
      {body}
    </details>
  );
}

function savedViewUrl(projectId: string, viewId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(
    projectId
  )}/semantic-saved-views`;
  return viewId ? `${base}/${encodeURIComponent(viewId)}` : base;
}

function savedViewError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 409) {
      return "Представление с таким названием уже существует.";
    }
    if (error.status === 412) {
      return "Представление изменилось в другой вкладке. Обновите страницу.";
    }
    if (error.status === 403) {
      return "Недостаточно прав для изменения представлений.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return "Настройки представления содержат недопустимое значение. Обновите страницу и повторите сохранение.";
    }
  }
  return "Не удалось выполнить операцию с представлением.";
}
