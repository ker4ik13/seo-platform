"use client";

import { SemanticModal } from "./semantic-modal";

export function OperationStopConfirmation({
  busy,
  description,
  onCancel,
  onConfirm,
  title
}: Readonly<{
  busy: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}>) {
  return (
    <SemanticModal
      description="Проверьте выбранную операцию перед остановкой."
      onClose={busy ? () => undefined : onCancel}
      size="small"
      title="Остановить операцию?"
    >
      <div className="semantic-confirm-dialog operation-stop-confirmation">
        <div className="inline-alert warning" role="alert">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <p>
          Новые запросы перестанут обрабатываться. Уже сохранённые результаты и
          текущий прогресс останутся в журнале.
        </p>
        <div className="semantic-modal-actions">
          <button
            autoFocus
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Продолжить сбор
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Останавливаем…" : "Остановить"}
          </button>
        </div>
      </div>
    </SemanticModal>
  );
}
