"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode
} from "react";

export function SemanticModal({
  bodyClassName,
  children,
  description,
  footer,
  headerActions,
  onClose,
  size = "medium",
  title
}: Readonly<{
  bodyClassName?: string;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
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
      onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outside) onClose();
      }}
      ref={dialogRef}
    >
      <header className="semantic-modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <div className="semantic-modal-header-actions">
          {headerActions}
          <button
            aria-label="Закрыть окно"
            className="semantic-modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
      </header>
      <div className={`semantic-modal-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {children}
      </div>
      {footer && <footer className="semantic-modal-footer">{footer}</footer>}
    </dialog>
  );
}
