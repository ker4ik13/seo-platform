"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode
} from "react";

export function SemanticModal({
  children,
  description,
  footer,
  onClose,
  size = "medium",
  title
}: Readonly<{
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  size?: "small" | "medium" | "large" | "fullscreen";
  title: string;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={`semantic-modal semantic-modal-${size}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <header className="semantic-modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button
          aria-label="Закрыть окно"
          className="semantic-modal-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      <div className="semantic-modal-body">{children}</div>
      {footer && <footer className="semantic-modal-footer">{footer}</footer>}
    </dialog>
  );
}
