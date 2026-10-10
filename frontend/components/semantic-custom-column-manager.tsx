"use client";

import { CustomSelect } from "./custom-select";
import { useConfirmation } from "./use-confirmation";

import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  customColumnSupportsOptions,
  customColumnTypeLabel,
  type SemanticCustomColumn,
  type SemanticCustomColumnType
} from "./semantic-custom-column-types";
import { UiText, useUiLocale } from "./ui-locale";


interface ColumnDraft {
  readonly name: string;
  readonly description: string;
  readonly type: SemanticCustomColumnType;
  readonly required: boolean;
  readonly options: string;
}

interface SemanticCustomColumnManagerProps {
  readonly onChanged: () => void;
  readonly projectId: string;
}

const emptyDraft: ColumnDraft = {
  name: "",
  description: "",
  type: "TEXT",
  required: false,
  options: ""
};

export function SemanticCustomColumnManager({
  onChanged,
  projectId
}: SemanticCustomColumnManagerProps) {
  const { t: uiText } = useUiLocale();
  const [columns, setColumns] = useState<readonly SemanticCustomColumn[]>([]);
  const [draft, setDraft] = useState<ColumnDraft>(emptyDraft);
  const [editing, setEditing] = useState<SemanticCustomColumn>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  const confirmation = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticCustomColumn[]>(
      columnUrl(projectId),
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setColumns(result);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(columnError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, retryVersion]);

  function startCreate(): void {
    setEditing(undefined);
    setDraft(emptyDraft);
    setError(undefined);
    setOpen(true);
  }

  function startEdit(column: SemanticCustomColumn): void {
    setEditing(column);
    setDraft({
      name: column.name,
      description: column.description ?? "",
      type: column.type,
      required: column.config.required,
      options:
        column.config.options?.map(({ label }) => label).join("\n") ?? ""
    });
    setError(undefined);
    setOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    const config = {
      required: draft.required,
      ...(customColumnSupportsOptions(draft.type)
        ? { options: optionPayload(draft.options) }
        : {})
    };
    try {
      if (editing) {
        await browserApiRequest<SemanticCustomColumn>(
          columnUrl(projectId, editing.id),
          {
            method: "PATCH",
            ifMatch: editing.version,
            body: {
              name: draft.name,
              description: draft.description || null,
              config
            }
          }
        );
      } else {
        await browserApiRequest<SemanticCustomColumn>(columnUrl(projectId), {
          method: "POST",
          body: {
            name: draft.name,
            ...(draft.description
              ? { description: draft.description }
              : {}),
            type: draft.type,
            config
          }
        });
      }
      setOpen(false);
      setEditing(undefined);
      setRetryVersion((value) => value + 1);
      onChanged();
    } catch (requestError) {
      setError(columnError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteColumn(column: SemanticCustomColumn): Promise<void> {
    if (!await confirmation.confirm({ title: uiText("Удалить колонку «{0}»?", [column.name]), description: "Значения перестанут отображаться." })) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await browserApiRequest<void>(columnUrl(projectId, column.id), {
        method: "DELETE",
        ifMatch: column.version
      });
      setRetryVersion((value) => value + 1);
      onChanged();
    } catch (requestError) {
      setError(columnError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel semantic-custom-columns">
      <header className="panel-header">
        <div>
          <h2><UiText text="Пользовательские колонки" /></h2>
          <p><UiText text="Типизированные поля с индексируемыми значениями" /></p>
        </div>
        <button className="secondary-button" onClick={startCreate} type="button">
          <UiText text="Добавить колонку" /></button>
      </header>

      {open && (
        <form
          className="semantic-custom-column-editor"
          onSubmit={(event) => void save(event)}
        >
          <label>
            <span><UiText text="Название" /></span>
            <input
              autoFocus
              maxLength={160}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              required
              value={draft.name}
            />
          </label>
          <label>
            <span><UiText text="Тип" /></span>
            <CustomSelect
              disabled={Boolean(editing)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  type: event.target.value as SemanticCustomColumnType
                }))
              }
              value={draft.type}
            >
              {columnTypes.map((type) => (
                <option key={type} value={type}>
                  {<UiText text={customColumnTypeLabel(type) ?? ""} />}
                </option>
              ))}
            </CustomSelect>
          </label>
          <label className="semantic-custom-description">
            <span><UiText text="Описание" /></span>
            <input
              maxLength={2000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value
                }))
              }
              value={draft.description}
            />
          </label>
          {customColumnSupportsOptions(draft.type) && (
            <label className="semantic-custom-options">
              <span><UiText text="Варианты — по одному на строку" /></span>
              <textarea
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    options: event.target.value
                  }))
                }
                placeholder={uiText("Новый В работе Готово")}
                required
                rows={4}
                value={draft.options}
              />
            </label>
          )}
          <label className="semantic-custom-required">
            <input
              checked={draft.required}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  required: event.target.checked
                }))
              }
              type="checkbox"
            />
            <span><UiText text="Обязательное поле" /></span>
          </label>
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setOpen(false)}
              type="button"
            >
              <UiText text="Отмена" /></button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      {loading ? (
        <div className="semantic-group-skeleton"><UiText text="Загружаем колонки…" /></div>
      ) : columns.length === 0 ? (
        <div className="semantic-group-empty">
          <strong><UiText text="Пользовательских колонок пока нет" /></strong>
          <span><UiText text="Добавьте поле для собственной классификации запросов." /></span>
        </div>
      ) : (
        <div className="semantic-custom-column-list">
          {columns.map((column) => (
            <article key={column.id}>
              <div>
                <strong>{column.name}</strong>
                <span>
                  {<UiText text={customColumnTypeLabel(column.type) ?? ""} />}
                  {column.config.required ? <UiText text="· обязательная" before=" " /> : ""}
                </span>
              </div>
              <button
                className="text-button"
                disabled={saving}
                onClick={() => startEdit(column)}
                type="button"
              >
                <UiText text="Настроить" /></button>
              <button
                className="text-button danger-text"
                disabled={saving}
                onClick={() => void deleteColumn(column)}
                type="button"
              >
                <UiText text="Удалить" /></button>
            </article>
          ))}
        </div>
      )}
      {confirmation.dialog}
    </section>
  );
}

const columnTypes: readonly SemanticCustomColumnType[] = [
  "TEXT",
  "LONG_TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "SELECT",
  "MULTI_SELECT",
  "URL",
  "USER",
  "STATUS"
];

function optionPayload(source: string) {
  const labels = source
    .split(/\r?\n/u)
    .map((value) => value.normalize("NFKC").trim())
    .filter(Boolean);
  return labels.map((label, index) => ({
    id: `option_${index + 1}`,
    label
  }));
}

function columnUrl(projectId: string, columnId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(
    projectId
  )}/semantic-custom-columns`;
  return columnId ? `${base}/${encodeURIComponent(columnId)}` : base;
}

function columnError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 409) {
      return "Колонка с таким названием уже существует.";
    }
    if (error.status === 412) {
      return "Колонка изменилась в другой вкладке. Обновите страницу.";
    }
    if (error.status === 403) {
      return "Недостаточно прав для управления колонками.";
    }
    if (error.status === 422) {
      return "Проверьте название, тип и варианты значений.";
    }
  }
  return "Не удалось выполнить операцию с колонкой.";
}
