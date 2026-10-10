"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";
import { useUiLocale } from "./ui-locale";

export function InfoTooltip({
  children,
  label = "Подробнее",
}: Readonly<{
  children: ReactNode;
  label?: string;
  portal?: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  return (
      <FloatingInfoTooltip label={uiText(label)}>
        {children}
      </FloatingInfoTooltip>
  );
}

function FloatingInfoTooltip({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
  }>();
  const [host, setHost] = useState<Element>();
  const suppressFocus = useRef(false);
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }
  function show() {
    cancelClose();
    const anchor = trigger.current;
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect(),
      width = Math.min(320, window.innerWidth - 24);
    setHost(
      anchor.closest("dialog[open]") ??
        anchor.closest(".app-shell, .admin-root") ??
        document.body,
    );
    setPosition({
      width,
      left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
      top: bounds.bottom + 8,
    });
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setPosition(undefined), 150);
  }
  useLayoutEffect(() => {
    if (!position || !popup.current || !trigger.current) return;
    const height = popup.current.getBoundingClientRect().height;
    if (position.top + height > window.innerHeight - 12) {
      const top = Math.max(
        12,
        trigger.current.getBoundingClientRect().top - height - 8,
      );
      if (top !== position.top) setPosition({ ...position, top });
    }
  }, [position]);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(undefined);
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        if (popup.current?.contains(document.activeElement)) {
          suppressFocus.current = true;
          trigger.current?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [position]);
  useEffect(() => () => cancelClose(), []);
  return (
    <span className="info-tooltip-floating">
      <button
        aria-describedby={position ? id : undefined}
        aria-label={label}
        className="info-tooltip-floating-trigger"
        onBlur={scheduleClose}
        onClick={event => { event.preventDefault(); event.stopPropagation(); show(); }}
        onFocus={() => { if (suppressFocus.current) suppressFocus.current = false; else show(); }}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
        ref={trigger}
        type="button"
      >
        <Icon name="info" />
      </button>
      {position &&
        host &&
        createPortal(
          <span
            className="info-tooltip-floating-content"
            id={id}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocusCapture={cancelClose}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
            }}
            ref={popup}
            role="tooltip"
            style={{ position: "fixed", ...position }}
          >
            {children}
          </span>,
          host,
        )}
    </span>
  );
}
