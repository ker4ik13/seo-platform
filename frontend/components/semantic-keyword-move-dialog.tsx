"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { SemanticKeywordBulkResult } from "@seo-platform/contracts";
import { BrowserApiError } from "../lib/browser-api";
import { updateSemanticKeywordsInBatches } from "../lib/semantic-keyword-bulk";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { SemanticModal } from "./semantic-modal";
import { Icon } from "./icon";
import { SemanticGroupPicker } from "./semantic-group-picker";

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
  selections: readonly Readonly<{
    id: string;
    version: number;
    text: string;
    currentGroupPath?: string;
  }>[];
}>) {
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => !systemKind),
    [groups]
  );
  const safeInitialGroupId = availableGroups.some(({ id }) => id === initialGroupId)
    ? initialGroupId
    : "";
  const [groupId, setGroupId] = useState(safeInitialGroupId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const selectedGroup = availableGroups.find(({ id }) => id === groupId);
  const currentLocation = moveCurrentLocation(selections);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await updateSemanticKeywordsInBatches(
        projectId,
        selections,
        { groupId: groupId || null }
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
      description={`Выбрано запросов: ${selections.length}. Выберите папку в дереве — вложенность и путь сохранятся.`}
      onClose={saving ? () => undefined : onClose}
      presenceKey="semantic-modal:move-keywords"
      size="medium"
      title="Перенести запросы"
    >
      <form className="semantic-dialog-form semantic-move-dialog" onSubmit={(event) => void submit(event)}>
        <div className="semantic-move-current-summary">
          <span className="semantic-move-current-icon"><Icon name="inbox" /></span>
          <span>
            <small>{selections.length === 1 ? "Текущая группа" : "Сейчас находятся"}</small>
            <strong title={currentLocation.title}>{currentLocation.label}</strong>
          </span>
          {currentLocation.detail && <b>{currentLocation.detail}</b>}
        </div>
        <div className="semantic-move-target-summary">
          <span className="semantic-move-target-icon"><Icon name="move" /></span>
          <span>
            <small>Целевая группа</small>
            <strong>{selectedGroup?.path ?? "Без группы"}</strong>
          </span>
          <b>{selections.length}</b>
        </div>

        <SemanticGroupPicker
          autoFocus
          groups={availableGroups}
          onChange={setGroupId}
          value={groupId}
        />

        <details className="semantic-move-selection">
          <summary>Переносимые запросы · {selections.length}</summary>
          <div className="semantic-dialog-selection">
            {selections.slice(0, 30).map((selection) => (
              <span key={selection.id}>{selection.text}</span>
            ))}
            {selections.length > 30 && <span>Ещё {selections.length - 30}</span>}
          </div>
        </details>

        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Переносим…" : `Перенести (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function moveCurrentLocation(
  selections: readonly Readonly<{ currentGroupPath?: string }>[]
): Readonly<{ label: string; title: string; detail?: string }> {
  const paths = selections.map(({ currentGroupPath }) => currentGroupPath?.trim() || "Без группы");
  const unique = [...new Set(paths)];
  if (selections.length === 1) {
    return { label: unique[0] ?? "Без группы", title: unique[0] ?? "Без группы" };
  }
  if (unique.length === 1) {
    return {
      label: unique[0] ?? "Без группы",
      title: unique[0] ?? "Без группы",
      detail: `${selections.length} запросов`
    };
  }
  return {
    label: `${unique.length} разных групп`,
    title: unique.join("\n"),
    detail: `${selections.length} запросов`
  };
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
