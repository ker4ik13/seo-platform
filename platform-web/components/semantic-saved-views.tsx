"use client";

import { CustomSelect } from "./custom-select";

import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import type {
  SemanticSavedView,
  SemanticViewConfig
} from "./semantic-view-types";
import { isInternalSemanticViewName } from "./semantic-view-types";

interface SemanticSavedViewsProps {
  readonly config: SemanticViewConfig;
  readonly projectId: string;
  readonly onApply: (view: SemanticSavedView) => void;
}

export function SemanticSavedViews({
  config,
  projectId,
  onApply
}: SemanticSavedViewsProps) {
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

  async function createView(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const created = await browserApiRequest<SemanticSavedView>(
        savedViewUrl(projectId),
        {
          method: "POST",
          body: { name, scope, config }
        }
      );
      setViews((current) =>
        [...current, created].sort((left, right) =>
          left.name.localeCompare(right.name, "ru")
        )
      );
      setName("");
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
      const updated = await browserApiRequest<SemanticSavedView>(
        savedViewUrl(projectId, view.id),
        { method: "PATCH", body: { config }, ifMatch: view.version }
      );
      setViews((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
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
      setViews((current) => current.filter(({ id }) => id !== view.id));
    } catch (requestError) {
      setError(savedViewError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="semantic-saved-views" data-exclusive-dropdown>
      <summary>
        Представления
        <span>{loading ? "…" : visibleViews.length}</span>
      </summary>
      <div className="semantic-saved-views-body">
        {visibleViews.length === 0 && !loading ? (
          <p>Сохранённых представлений пока нет.</p>
        ) : (
          <ul>
            {visibleViews.map((view) => (
              <li key={view.id}>
                <button
                  className="semantic-view-name"
                  onClick={() => onApply(view)}
                  type="button"
                >
                  <strong>{view.name}</strong>
                  <small>
                    {view.scope === "PRIVATE" ? "Личное" : "Общее"}
                  </small>
                </button>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => void replaceView(view)}
                  title="Заменить настройки представления текущими"
                  type="button"
                >
                  Обновить
                </button>
                <button
                  className="text-button danger-text"
                  disabled={saving}
                  onClick={() => void deleteView(view)}
                  type="button"
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(event) => void createView(event)}>
          <label>
            <span className="visually-hidden">Название представления</span>
            <input
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder="Название представления"
              required
              value={name}
            />
          </label>
          <CustomSelect
            aria-label="Доступ к представлению"
            onChange={(event) =>
              setScope(event.target.value as typeof scope)
            }
            value={scope}
          >
            <option value="PRIVATE">Личное</option>
            <option value="PROJECT_SHARED">Общее для проекта</option>
          </CustomSelect>
          <button className="secondary-button" disabled={saving} type="submit">
            {saving ? "Сохраняем…" : "Сохранить вид"}
          </button>
        </form>
        {error && (
          <div className="inline-alert danger" role="alert">
            {error}
          </div>
        )}
      </div>
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
  }
  return "Не удалось выполнить операцию с представлением.";
}
