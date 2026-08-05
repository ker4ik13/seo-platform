"use client";

import { CustomSelect } from "./custom-select";

import { useState, type FormEvent } from "react";
import type { SemanticKeywordBulkResult } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { SemanticModal } from "./semantic-modal";

export function SemanticKeywordMoveDialog({
  groups,
  initialGroupId = "",
  onClose,
  onCompleted,
  projectId,
  selections
}: Readonly<{
  groups: readonly SemanticGroupTreeItem[];
  initialGroupId?: string;
  onClose: () => void;
  onCompleted: (result: SemanticKeywordBulkResult) => void;
  projectId: string;
  selections: readonly Readonly<{ id: string; version: number; text: string }>[];
}>) {
  const [groupId, setGroupId] = useState(initialGroupId);
  const [keepCurrent, setKeepCurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticKeywordBulkResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands`,
        {
          method: "POST",
          body: {
            items: selections.map(({ id, version }) => ({ id, version })),
            patch: { groupId: groupId || null }
          }
        }
      );
      onCompleted(result);
    } catch (requestError) {
      setError(moveErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SemanticModal
      description={`Выбрано запросов: ${selections.length}. Перенос использует версии строк и не перезаписывает параллельные изменения.`}
      onClose={saving ? () => undefined : onClose}
      size="small"
      title="Перенести запросы"
    >
      <form className="semantic-dialog-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Целевая группа</span>
          <CustomSelect autoFocus onChange={(event) => setGroupId(event.target.value)} value={groupId}>
            <option value="">Без группы</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.path}</option>
            ))}
          </CustomSelect>
        </label>
        <div className="semantic-dialog-selection">
          {selections.slice(0, 8).map((selection) => (
            <span key={selection.id}>{selection.text}</span>
          ))}
          {selections.length > 8 && <span>Ещё {selections.length - 8}</span>}
        </div>
        <label className="semantic-dialog-checkbox">
          <input checked={keepCurrent} onChange={(event) => setKeepCurrent(event.target.checked)} type="checkbox" />
          <span>Сохранить копию в текущей группе</span>
        </label>
        {keepCurrent && (
          <div className="inline-alert warning" role="note">
            Один запрос имеет одну основную группу. Копирование создаст дубликаты и
            поэтому недоступно; снимите флажок для безопасного переноса.
          </div>
        )}
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={saving || keepCurrent} type="submit">
            {saving ? "Переносим…" : `Перенести (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function moveErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") return "Часть запросов уже изменена. Обновите таблицу и повторите перенос.";
    if (error.code === "FORBIDDEN") return "Недостаточно прав для переноса запросов.";
    if (error.code === "VALIDATION_FAILED") return error.fieldErrors[0]?.message ?? "Проверьте целевую группу.";
    return error.message;
  }
  return "Не удалось перенести запросы.";
}
