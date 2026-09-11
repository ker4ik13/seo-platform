"use client";

import { SemanticModal } from "./semantic-modal";
import { useUiLocale, UiText } from "./ui-locale";

export function OperationDismissConfirmation({
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
  const { t: uiText } = useUiLocale();
  return (
    <SemanticModal
      description={uiText("Операция исчезнет из пользовательского журнала.")}
      onClose={busy ? () => undefined : onCancel}
      size="small"
      title={uiText("Удалить операцию?")}
    >
      <div className="semantic-confirm-dialog operation-stop-confirmation">
        <div className="inline-alert danger" role="alert">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <p>
          <UiText text="Сохранённые результаты, расчёты и аудит останутся доступными системе." /></p>
        <div className="semantic-modal-actions">
          <button
            autoFocus
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <UiText text="Отмена" /></button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <UiText text="Удаляем…" /> : <UiText text="Удалить" />}
          </button>
        </div>
      </div>
    </SemanticModal>
  );
}
