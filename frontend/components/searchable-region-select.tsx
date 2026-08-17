"use client";

import { useMemo } from "react";
import { CustomSelect } from "./custom-select";
import {
  seoRegionOptions,
  type SeoRegionCodeKind
} from "../lib/seo-regions";

export function SearchableRegionSelect({
  allowAll = false,
  autoFocus = false,
  kind,
  onChange,
  value,
  valueLabel
}: Readonly<{
  allowAll?: boolean;
  autoFocus?: boolean;
  kind: SeoRegionCodeKind;
  onChange: (value: { readonly code: string; readonly label: string }) => void;
  value: string;
  valueLabel?: string;
}>) {
  const options = useMemo(
    () => {
      const known = seoRegionOptions(kind);
      return [
        ...(value && !known.some(({ code }) => code === value)
          ? [{ code: value, label: valueLabel?.trim() || "Другой регион" }]
          : []),
        ...known,
        ...(allowAll ? [{ code: "ALL", label: "Без ограничения" }] : [])
      ];
    },
    [allowAll, kind, value, valueLabel]
  );
  return (
    <CustomSelect
      aria-label="Регион"
      autoFocus={autoFocus}
      onChange={(event) => {
        const match = options.find((option) => option.code === event.target.value);
        if (match) onChange(match);
      }}
      required
      searchable
      searchPlaceholder="Регион или код"
      value={value}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>{display(option)}</option>
      ))}
    </CustomSelect>
  );
}

function display(option: { readonly code: string; readonly label: string }): string {
  return `${option.label} — ${option.code}`;
}
