"use client";

import { useState } from "react";
import { parseSemanticPositionHistoryImportOptions, type SemanticPositionHistoryImportContext } from "@seo-platform/contracts";
import { SemanticModal } from "./semantic-modal";
import { CustomSelect } from "./custom-select";
import { SearchableRegionSelect } from "./searchable-region-select";
import { LanguageSelect } from "./locale-selects";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticImportDateContext({ value, onApply, onDefault, onClose }: Readonly<{
  value: SemanticPositionHistoryImportContext;
  onApply: (value: SemanticPositionHistoryImportContext) => void;
  onDefault: () => void;
  onClose: () => void;
}>) {
  const { t } = useUiLocale();
  const [draft, setDraft] = useState<SemanticPositionHistoryImportContext>(() => ({
    searchEngine: value.searchEngine, countryCode: value.countryCode, regionCode: value.regionCode,
    regionLabel: value.regionLabel, language: value.language, device: value.device,
  }));
  let valid = false;
  try { parseSemanticPositionHistoryImportOptions(draft); valid = true; } catch { /* Incomplete local form. */ }
  return <SemanticModal title="Параметры снимка" size="small" onClose={onClose} footer={
    <div className="import-date-context-actions">
      <button className="secondary-button" type="button" onClick={onDefault}><UiText text="По умолчанию" /></button>
      <button className="primary-button" type="button" disabled={!valid} onClick={() => onApply(draft)}><UiText text="Применить" /></button>
    </div>
  }>
    <div className="import-date-context-fields">
      <label><span><UiText text="Поисковая система" /></span><CustomSelect aria-label={t("Поисковая система")} value={draft.searchEngine} onChange={event => {
        const searchEngine = event.target.value === "GOOGLE" ? "GOOGLE" : "YANDEX";
        setDraft(current => ({ ...current, searchEngine, regionCode: "", regionLabel: "" }));
      }}><option value="YANDEX"><SearchEngineLogo engine="YANDEX" size="compact" /><UiText text="Яндекс" /></option>
        <option value="GOOGLE"><SearchEngineLogo engine="GOOGLE" size="compact" />Google</option></CustomSelect></label>
      <label><span><UiText text="Город / регион" /></span><SearchableRegionSelect kind={draft.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"} value={draft.regionCode} valueLabel={draft.regionLabel} onChange={({ code, label }) => setDraft(current => ({ ...current, regionCode: code, regionLabel: label }))} /></label>
      <label><span><UiText text="Устройство" /></span><CustomSelect value={draft.device} onChange={event => setDraft(current => ({ ...current, device: event.target.value === "MOBILE" ? "MOBILE" : "DESKTOP" }))}>
        <option value="DESKTOP"><UiText text="ПК" /></option><option value="MOBILE"><UiText text="Телефон" /></option>
      </CustomSelect></label>
      <label><span><UiText text="Язык выдачи" /></span><LanguageSelect value={draft.language} onChange={event => setDraft(current => ({ ...current, language: event.target.value }))} /></label>
    </div>
  </SemanticModal>;
}
