"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode
} from "react";

export function SemanticModal({
  bodyClassName,
  children,
  className,
  description,
  footer,
  headerActions,
  onClose,
  presenceKey,
  size = "medium",
  style,
  title
}: Readonly<{
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  description?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onClose: () => void;
  presenceKey?: string;
  size?: "small" | "medium" | "large" | "fullscreen";
  style?: CSSProperties;
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
      className={`semantic-modal semantic-modal-${size}${className ? ` ${className}` : ""}`}
      data-presence-cursor-anchor="true"
      data-presence-key={presenceKey ?? "semantic-modal"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        // Portalled controls (for example CustomSelect) are mounted under the
        // dialog so they stay inside the native modal top layer, but their
        // popovers may be positioned outside the dialog rectangle. A click on
        // such a child must never be treated as a backdrop click.
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outside) onClose();
      }}
      ref={dialogRef}
      style={style}
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
