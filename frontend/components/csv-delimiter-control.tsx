"use client";

import { useState } from "react";
import { projectNoteDelimiter } from "@seo-platform/contracts";
import { CustomSelect } from "./custom-select";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./csv-delimiter-control.module.css";

export function CsvDelimiterControl({ value, disabled, onChange, onValidityChange }: Readonly<{
  value: string; disabled?: boolean; onChange: (value: string) => void; onValidityChange: (valid: boolean) => void;
}>) {
  const { t } = useUiLocale();
  const [custom, setCustom] = useState(value !== "," && value !== ";");
  const [text, setText] = useState(custom ? value : "");
  const [error, setError] = useState(false);
  function update(text: string) {
    setText(text);
    try { const delimiter = projectNoteDelimiter(text); if (!delimiter) throw new Error(); setError(false); onValidityChange(true); onChange(delimiter); }
    catch { setError(true); onValidityChange(false); }
  }
  return <div className={styles.control}>
    <CustomSelect aria-label={t("Разделитель CSV")} disabled={disabled} value={custom ? "CUSTOM" : value} onChange={event => {
      const next = event.target.value; setCustom(next === "CUSTOM");
      if (next === "CUSTOM") update(text); else { setError(false); onValidityChange(true); onChange(next); }
    }}><option value=","><UiText text="Запятая (,)" /></option><option value=";"><UiText text="Точка с запятой (;)" /></option><option value="CUSTOM"><UiText text="Свой символ" /></option></CustomSelect>
    {custom && <input aria-label={t("Свой разделитель")} aria-invalid={error} disabled={disabled} value={text} placeholder="|" onChange={event => update(event.target.value)} />}
    {error && <small role="alert"><UiText text="Введите один символ, кроме кавычек и управляющих символов." /></small>}
  </div>;
}
