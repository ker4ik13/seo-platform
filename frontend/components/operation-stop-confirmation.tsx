"use client";

import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { useUiLocale, UiText } from "./ui-locale";

export function OperationStopConfirmation({
  busy,
  description,
  onCancel,
  onConfirm,
  title,
}: Readonly<{
  busy: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <SemanticModal
      onClose={busy ? () => undefined : onCancel}
      size="small"
      title={uiText("Остановить операцию?")}
    >
      <div className="semantic-confirm-dialog operation-stop-confirmation">
        <div className="inline-alert warning" role="alert">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <p>
          <UiText text="Новые запросы перестанут обрабатываться. Уже сохранённые результаты и текущий прогресс останутся в журнале." />
        </p>
        <ConfirmationActions>
          <button
            autoFocus
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <UiText text="Продолжить сбор" />
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? (
              <UiText text="Останавливаем…" />
            ) : (
              <UiText text="Остановить" />
            )}
          </button>
        </ConfirmationActions>
      </div>
    </SemanticModal>
  );
}
