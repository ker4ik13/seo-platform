"use client";

import type { SemanticRankDimension } from "@seo-platform/contracts";
import { rankDimensionLabel } from "../lib/rank-dimension-presentation";
import { CustomSelect } from "./custom-select";
import { SemanticRankContext } from "./semantic-rank-context";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./rank-dimension-select.module.css";

export function RankDimensionSelect({ dimensions, value, onChange, ariaLabel, emptyLabel = "Срезов с позициями пока нет", disabled = false }: Readonly<{
  dimensions: readonly SemanticRankDimension[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
}>) {
  const { locale, t } = useUiLocale();
  const selected = dimensions.find((dimension) => dimension.key === value);
  return <CustomSelect aria-label={ariaLabel} className={styles.select} disabled={disabled || dimensions.length === 0} value={value} onChange={(event) => onChange(event.target.value)} searchable searchPlaceholder={t("Найти город или устройство")} popoverMinWidth={360} popoverClassName={styles.popover!} selectedLabel={selected && <SemanticRankContext {...selected} showEngineName={false} />}>
    {dimensions.length === 0 && <option value=""><UiText text={emptyLabel} /></option>}
    {dimensions.map((dimension) => <option key={dimension.key} value={dimension.key} label={rankDimensionLabel(dimension, locale)}><SemanticRankContext {...dimension} />{dimension.language !== "ru" && <small className={styles.language}>{dimension.language}</small>}</option>)}
  </CustomSelect>;
}
