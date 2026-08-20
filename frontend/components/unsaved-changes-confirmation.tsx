"use client";

import { SemanticModal } from "./semantic-modal";

export function UnsavedChangesConfirmation({
  onCancel,
  onConfirm
}: Readonly<{
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <SemanticModal
      description="Проверьте действие перед закрытием."
      onClose={onCancel}
      presenceKey="semantic-modal:unsaved-changes"
      size="small"
      title="Закрыть без сохранения?"
    >
      <div className="semantic-confirm-dialog unsaved-changes-confirmation">
        <div className="inline-alert warning" role="alert">
          <strong>Внесённые изменения будут потеряны</strong>
          <span>Настройки и выбранные элементы в этом окне не сохранятся.</span>
        </div>
        <div className="semantic-modal-actions">
          <button autoFocus className="secondary-button" onClick={onCancel} type="button">
            Продолжить редактирование
          </button>
          <button className="danger-button" onClick={onConfirm} type="button">
            Закрыть
          </button>
        </div>
      </div>
    </SemanticModal>
  );
}
