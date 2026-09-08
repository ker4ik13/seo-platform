"use client";

import { useMemo } from "react";
import { CustomSelect } from "./custom-select";
import {
  seoRegionOptions,
  type SeoRegionCodeKind
} from "../lib/seo-regions";
import { useUiLocale } from "./ui-locale";


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
  const { t: uiText } = useUiLocale();
  const options = useMemo(
    () => {
      const known = seoRegionOptions(kind);
      return [
        ...(value && !known.some(({ code }) => code === value)
          ? [{ code: value, label: valueLabel?.trim() || "Другой регион", translate: !valueLabel?.trim() }]
          : []),
        ...known.map(option => ({ ...option, translate: true })),
        ...(allowAll ? [{ code: "ALL", label: "Без ограничения", translate: true }] : [])
      ];
    },
    [allowAll, kind, value, valueLabel]
  );
  return (
    <CustomSelect
      aria-label={uiText("Регион")}
      autoFocus={autoFocus}
      onChange={(event) => {
        const match = options.find((option) => option.code === event.target.value);
        if (match) onChange({ code: match.code, label: match.label });
      }}
      required
      searchable
      searchPlaceholder={uiText("Регион или код")}
      value={value}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>{display({ ...option, label: option.translate ? uiText(option.label) : option.label })}</option>
      ))}
    </CustomSelect>
  );
}

function display(option: { readonly code: string; readonly label: string }): string {
  return `${option.label} — ${option.code}`;
}
