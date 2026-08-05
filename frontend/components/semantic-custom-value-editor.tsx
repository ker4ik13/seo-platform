"use client";

import { CustomSelect } from "./custom-select";

import { useState, type FormEvent } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import type { SemanticCustomColumn } from "./semantic-custom-column-types";

type CustomValueData = string | number | boolean | readonly string[];

interface ExistingCustomValue {
  readonly columnId: string;
  readonly value: CustomValueData;
  readonly version: number;
}

interface SemanticCustomValueEditorProps {
  readonly column: SemanticCustomColumn;
  readonly existing: ExistingCustomValue | undefined;
  readonly keywordId: string;
  readonly keywordText: string;
  readonly onCancel: () => void;
  readonly onCompleted: () => void;
  readonly projectId: string;
}

export function SemanticCustomValueEditor({
  column,
  existing,
  keywordId,
  keywordText,
  onCancel,
  onCompleted,
  projectId
}: SemanticCustomValueEditorProps) {
  const [value, setValue] = useState<string | boolean | readonly string[]>(
    editorValue(column, existing?.value)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    if (Array.isArray(value) && value.length === 0) {
      if (existing) {
        await clear();
      } else {
        setError("Выберите хотя бы один вариант.");
      }
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await browserApiRequest(
        customValueUrl(projectId, keywordId, column.id),
        {
          method: "PUT",
          body: {
            expectedVersion: existing?.version ?? null,
            value: requestValue(column, value)
          }
        }
      );
      onCompleted();
    } catch (requestError) {
      setError(customValueError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function clear(): Promise<void> {
    if (!existing || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await browserApiRequest<void>(
        customValueUrl(projectId, keywordId, column.id),
        { method: "DELETE", ifMatch: existing.version }
      );
      onCompleted();
    } catch (requestError) {
      setError(customValueError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="semantic-custom-value-editor"
      onSubmit={(event) => void save(event)}
    >
      <div>
        <strong>{column.name}</strong>
        <span title={keywordText}>{keywordText}</span>
      </div>
      <CustomValueControl
        column={column}
        onChange={setValue}
        value={value}
      />
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      <div className="semantic-editor-actions">
        {existing && (
          <button
            className="text-button danger-text"
            disabled={saving}
            onClick={() => void clear()}
            type="button"
          >
            Очистить
          </button>
        )}
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? "Сохраняем…" : "Сохранить значение"}
        </button>
      </div>
    </form>
  );
}

function CustomValueControl({
  column,
  onChange,
  value
}: Readonly<{
  column: SemanticCustomColumn;
  onChange: (value: string | boolean | readonly string[]) => void;
  value: string | boolean | readonly string[];
}>) {
  if (column.type === "BOOLEAN") {
    return (
      <label>
        <span>Значение</span>
        <CustomSelect
          onChange={(event) => onChange(event.target.value === "true")}
          value={String(value)}
        >
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </CustomSelect>
      </label>
    );
  }
  if (column.type === "SELECT" || column.type === "STATUS") {
    return (
      <label>
        <span>Значение</span>
        <CustomSelect
          onChange={(event) => onChange(event.target.value)}
          required
          value={String(value)}
        >
          {column.config.options?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </CustomSelect>
      </label>
    );
  }
  if (column.type === "MULTI_SELECT") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset>
        <legend>Значения</legend>
        {column.config.options?.map((option) => (
          <label key={option.id}>
            <input
              checked={selected.has(option.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.id);
                else next.delete(option.id);
                onChange([...next]);
              }}
              type="checkbox"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (column.type === "LONG_TEXT") {
    return (
      <label>
        <span>Значение</span>
        <textarea
          maxLength={1_000_000}
          onChange={(event) => onChange(event.target.value)}
          required
          rows={4}
          value={String(value)}
        />
      </label>
    );
  }
  return (
    <label>
      <span>Значение</span>
      <input
        maxLength={column.type === "TEXT" ? 1_000 : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={column.type === "USER" ? "UUID пользователя" : undefined}
        required
        step={column.type === "INTEGER" ? "1" : undefined}
        type={inputType(column)}
        value={String(value)}
      />
    </label>
  );
}

function editorValue(
  column: SemanticCustomColumn,
  current: CustomValueData | undefined
): string | boolean | readonly string[] {
  if (current !== undefined) {
    if (typeof current === "number") return String(current);
    if (column.type === "DATETIME" && typeof current === "string") {
      return current.slice(0, 16);
    }
    return current;
  }
  if (column.type === "BOOLEAN") return false;
  if (column.type === "MULTI_SELECT") return [];
  if (column.type === "SELECT" || column.type === "STATUS") {
    return column.config.options?.[0]?.id ?? "";
  }
  return "";
}

function requestValue(
  column: SemanticCustomColumn,
  value: string | boolean | readonly string[]
): CustomValueData {
  if (column.type === "INTEGER") return Number(value);
  if (column.type === "DATETIME") {
    return new Date(String(value)).toISOString();
  }
  return value;
}

function inputType(column: SemanticCustomColumn) {
  if (column.type === "INTEGER") return "number";
  if (column.type === "DATE") return "date";
  if (column.type === "DATETIME") return "datetime-local";
  if (column.type === "URL") return "url";
  return "text";
}

function customValueUrl(
  projectId: string,
  keywordId: string,
  columnId: string
): string {
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/keywords/${encodeURIComponent(
    keywordId
  )}/custom-values/${encodeURIComponent(columnId)}`;
}

function customValueError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 412) {
      return "Значение изменилось в другой вкладке. Обновите таблицу.";
    }
    if (error.status === 422 || error.status === 400) {
      return "Значение не соответствует типу или настройкам колонки.";
    }
    if (error.status === 403) {
      return "Недостаточно прав для изменения значения.";
    }
  }
  return "Не удалось сохранить значение.";
}
