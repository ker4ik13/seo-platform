"use client";
import type { ReactNode } from "react";

export function TableSortButton({ children, label, direction, disabled, onClick }: Readonly<{ children: ReactNode; label: string; direction?: "ascending" | "descending" | undefined; disabled?: boolean | undefined; onClick: () => void }>) {
  return <button aria-label={label} className={direction ? "active" : undefined} disabled={disabled} onClick={onClick} type="button"><span>{children}</span><i aria-hidden="true">{direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}</i></button>;
}
