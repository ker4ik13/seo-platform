"use client";

import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { useUiLocale, UiText } from "./ui-locale";

export function UnsavedChangesConfirmation({
  onCancel,
  onConfirm,
}: Readonly<{
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <SemanticModal
      onClose={onCancel}
      presenceKey="semantic-modal:unsaved-changes"
      size="small"
      title={uiText("Закрыть без сохранения?")}
    >
      <div className="semantic-confirm-dialog unsaved-changes-confirmation">
        <div className="inline-alert warning" role="alert">
          <strong>
            <UiText text="Внесённые изменения будут потеряны" />
          </strong>
        </div>
        <ConfirmationActions>
          <button
            autoFocus
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            <UiText text="Продолжить редактирование" />
          </button>
          <button className="danger-button" onClick={onConfirm} type="button">
            <UiText text="Закрыть" />
          </button>
        </ConfirmationActions>
      </div>
    </SemanticModal>
  );
}
