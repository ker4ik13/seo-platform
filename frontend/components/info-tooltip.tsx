"use client";

import { useId, type ReactNode } from "react";
import { Icon } from "./icon";
import { useUiLocale } from "./ui-locale";

export function InfoTooltip({
  children,
  label = "Подробнее"
}: Readonly<{
  children: ReactNode;
  label?: string;
}>) {
  const { t: uiText } = useUiLocale();
  const tooltipId = useId();
  return (
    <span className="info-tooltip">
      <span
        aria-describedby={tooltipId}
        aria-label={uiText(label)}
        className="info-tooltip-trigger"
        role="img"
        tabIndex={0}
      >
        <Icon name="info" />
      </span>
      <span className="info-tooltip-content" id={tooltipId} role="tooltip">
        {children}
      </span>
    </span>
  );
}
