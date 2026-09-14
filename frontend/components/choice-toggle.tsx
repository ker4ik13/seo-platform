"use client";

import type { ReactNode } from "react";


export interface ChoiceToggleOption<T extends string> {
  readonly label: ReactNode;
  readonly value: T;
  readonly title?: string;
}

export function ChoiceToggle<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value
}: Readonly<{
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: readonly ChoiceToggleOption<T>[];
  value: T;
}>) {
  return (
    <div
      aria-label={ariaLabel}
      className={`choice-toggle${className ? ` ${className}` : ""}`}
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={option.value === value ? "selected" : undefined}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
