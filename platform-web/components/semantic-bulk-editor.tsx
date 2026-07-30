"use client";

import { useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

interface BulkSelection {
  readonly id: string;
  readonly version: number;
}

interface BulkGroup {
  readonly id: string;
  readonly path: string;
}

interface BulkResult {
  readonly selected: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly conflicted: number;
}

type BulkIntent =
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "LOCAL"
  | "MIXED";

export function SemanticBulkEditor({
  projectId,
  selections,
  groups,
  onCancel,
  onCompleted
}: Readonly<{
  projectId: string;
  selections: readonly BulkSelection[];
  groups: readonly BulkGroup[];
  onCancel: () => void;
  onCompleted: (result: BulkResult) => void;
}>) {
  const [priority, setPriority] = useState("");
  const [favorite, setFavorite] = useState<"KEEP" | "YES" | "NO">("KEEP");
  const [intent, setIntent] = useState<"KEEP" | "CLEAR" | BulkIntent>("KEEP");
  const [groupId, setGroupId] = useState<"KEEP" | "CLEAR" | string>("KEEP");
  const [targetUrlMode, setTargetUrlMode] =
    useState<"KEEP" | "CLEAR" | "SET">("KEEP");
  const [targetUrl, setTargetUrl] = useState("");
  const [replaceTags, setReplaceTags] = useState(false);
  const [tagNames, setTagNames] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BulkResult>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const patch = {
      ...(priority === "" ? {} : { priority: Number(priority) }),
      ...(favorite === "KEEP"
        ? {}
        : { isFavorite: favorite === "YES" }),
      ...(intent === "KEEP"
        ? {}
        : { intent: intent === "CLEAR" ? null : intent }),
      ...(groupId === "KEEP"
        ? {}
        : { groupId: groupId === "CLEAR" ? null : groupId }),
      ...(targetUrlMode === "KEEP"
        ? {}
        : {
            targetUrl: targetUrlMode === "CLEAR" ? null : targetUrl
          }),
      ...(replaceTags ? { tagNames: parseTags(tagNames) } : {})
    };
    if (Object.keys(patch).length === 0) {
      setError("Выберите хотя бы одно изменение.");
      return;
    }
    setSaving(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await browserApiRequest<BulkResult>(
        `/app/api/projects/${encodeURIComponent(
          projectId
        )}/bulk-commands`,
        {
          method: "POST",
          body: { items: selections, patch }
        }
      );
      setResult(response);
      onCompleted(response);
    } catch (requestError) {
      setError(bulkErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="semantic-bulk-editor" onSubmit={(event) => void submit(event)}>
      <div className="semantic-bulk-heading">
        <div>
          <strong>Массовое изменение · {selections.length}</strong>
          <span>Версия проверяется отдельно для каждого запроса.</span>
        </div>
        <button
          className="text-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Закрыть
        </button>
      </div>
      <div className="semantic-bulk-grid">
        <label>
          <span>Приоритет</span>
          <input
            max={100}
            min={0}
            onChange={(event) => setPriority(event.target.value)}
            placeholder="Не менять"
            type="number"
            value={priority}
          />
        </label>
        <label>
          <span>Избранное</span>
          <select
            onChange={(event) =>
              setFavorite(event.target.value as typeof favorite)
            }
            value={favorite}
          >
            <option value="KEEP">Не менять</option>
            <option value="YES">Добавить</option>
            <option value="NO">Убрать</option>
          </select>
        </label>
        <label>
          <span>Интент</span>
          <select
            onChange={(event) =>
              setIntent(event.target.value as typeof intent)
            }
            value={intent}
          >
            <option value="KEEP">Не менять</option>
            <option value="CLEAR">Очистить</option>
            <option value="INFORMATIONAL">Информационный</option>
            <option value="NAVIGATIONAL">Навигационный</option>
            <option value="COMMERCIAL">Коммерческий</option>
            <option value="TRANSACTIONAL">Транзакционный</option>
            <option value="LOCAL">Локальный</option>
            <option value="MIXED">Смешанный</option>
          </select>
        </label>
        <label>
          <span>Группа</span>
          <select
            onChange={(event) => setGroupId(event.target.value)}
            value={groupId}
          >
            <option value="KEEP">Не менять</option>
            <option value="CLEAR">Без группы</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.path}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Целевая URL</span>
          <select
            onChange={(event) =>
              setTargetUrlMode(event.target.value as typeof targetUrlMode)
            }
            value={targetUrlMode}
          >
            <option value="KEEP">Не менять</option>
            <option value="CLEAR">Очистить</option>
            <option value="SET">Задать URL</option>
          </select>
        </label>
        {targetUrlMode === "SET" && (
          <label className="semantic-bulk-url">
            <span>Новая URL</span>
            <input
              onChange={(event) => setTargetUrl(event.target.value)}
              required
              type="url"
              value={targetUrl}
            />
          </label>
        )}
        <label className="semantic-bulk-tags">
          <span>
            <input
              checked={replaceTags}
              onChange={(event) => setReplaceTags(event.target.checked)}
              type="checkbox"
            />
            Заменить теги
          </span>
          <input
            disabled={!replaceTags}
            onChange={(event) => setTagNames(event.target.value)}
            placeholder="Важно, Услуги (пусто — удалить все)"
            value={tagNames}
          />
        </label>
      </div>
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="inline-alert success" role="status">
          Изменено: {result.changed}; конфликтов: {result.conflicted};
          пропущено: {result.skipped}; ошибок: {result.failed}.
        </div>
      )}
      <div className="semantic-editor-actions">
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? "Применяем…" : "Применить"}
        </button>
      </div>
    </form>
  );
}

function parseTags(value: string): readonly string[] {
  return [
    ...new Map(
      value
        .split(",")
        .map((tag) => tag.normalize("NFKC").trim())
        .filter(Boolean)
        .map((tag) => [tag.toLocaleLowerCase(), tag] as const)
    ).values()
  ].slice(0, 50);
}

function bulkErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "FORBIDDEN") {
      return "У вас нет права на массовое изменение семантики.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return error.fieldErrors[0]?.message ?? "Проверьте параметры изменения.";
    }
    return error.message;
  }
  return "Не удалось выполнить массовое изменение.";
}
