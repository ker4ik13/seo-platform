"use client";

import type { KeywordListQuery } from "@seo-platform/contracts";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

type TargetState = KeywordListQuery["targetUrlState"];
type MultipleState = KeywordListQuery["multipleUrlsState"];

export function KeywordUrlFilters({ className, targetUrlState, multipleUrlsState, showMultiple = true,
  onTargetChange, onMultipleChange }: Readonly<{
  className?: string;
  targetUrlState?: TargetState;
  multipleUrlsState?: MultipleState;
  showMultiple?: boolean;
  onTargetChange: (state: TargetState) => void;
  onMultipleChange: (state: MultipleState) => void;
}>) {
  const { t } = useUiLocale();
  return <>
    <label className={className}><span><UiText text="Целевой URL" /></span>
      <CustomSelect aria-label={t("Целевой URL")} value={targetUrlState ?? ""}
        onChange={event => onTargetChange(event.target.value === "SET" || event.target.value === "EMPTY" ? event.target.value : undefined)}>
        <option value=""><UiText text="Любой" /></option><option value="SET"><UiText text="Задан" /></option><option value="EMPTY"><UiText text="Не задан" /></option>
      </CustomSelect>
    </label>
    {showMultiple && <label className={className}><span><UiText text="Страницы сайта в выдаче" /></span>
      <CustomSelect aria-label={t("Несколько страниц сайта в выдаче")} value={multipleUrlsState ?? ""}
        onChange={event => onMultipleChange(event.target.value === "MULTIPLE" || event.target.value === "NOT_MULTIPLE" ? event.target.value : undefined)}>
        <option value=""><UiText text="Все запросы" /></option><option value="MULTIPLE"><UiText text="Несколько URL" /></option><option value="NOT_MULTIPLE"><UiText text="Без нескольких URL" /></option>
      </CustomSelect>
    </label>}
  </>;
}

export function KeywordUrlFilterChips({ targetUrlState, multipleUrlsState, onTargetClear, onMultipleClear }: Readonly<{
  targetUrlState?: TargetState;
  multipleUrlsState?: MultipleState;
  onTargetClear: () => void;
  onMultipleClear: () => void;
}>) {
  const { t } = useUiLocale();
  if (!targetUrlState && !multipleUrlsState) return null;
  return <div className="keyword-filter-chips" aria-label={t("Активные фильтры")}>
    {targetUrlState && <button type="button" onClick={onTargetClear} aria-label={t("Убрать фильтр целевого URL")}><UiText text={targetUrlState === "SET" ? "Целевой URL задан" : "Целевой URL не задан"} /><Icon name="close" /></button>}
    {multipleUrlsState && <button type="button" onClick={onMultipleClear} aria-label={t("Убрать фильтр нескольких URL")}><UiText text={multipleUrlsState === "MULTIPLE" ? "Несколько URL" : "Без нескольких URL"} /><Icon name="close" /></button>}
  </div>;
}
