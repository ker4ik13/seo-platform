import type { TrackingContextDraft } from "./tracking-contexts.ts";
import { normalizedUiLocale, translateUi } from "./ui-i18n.ts";
import { searchRegionDisplayName } from "./seo-regions.ts";

export interface RankTarget {
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly device: "DESKTOP" | "MOBILE";
}
export const rankTargetLimit = 64;

export function uniqueRankTargets(values: readonly RankTarget[]): readonly RankTarget[] {
  const targets = new Map<string, RankTarget>();
  for (const value of values) {
    const regionCode = value.regionCode.trim(), regionLabel = value.regionLabel.trim();
    if (!regionCode || regionCode.length > 100 || regionLabel.length > 160 || !["DESKTOP", "MOBILE"].includes(value.device)) throw new Error("Выберите город и устройство для каждого съёма.");
    const key = `${regionCode}:${value.device}`;
    if (!targets.has(key)) targets.set(key, { regionCode, regionLabel, device: value.device });
  }
  if (targets.size < 1 || targets.size > rankTargetLimit) throw new Error("За один запуск можно выбрать до 64 сочетаний города и устройства.");
  return [...targets.values()];
}

export function rankTargetDraft(base: TrackingContextDraft, target: RankTarget, competitorMode: boolean, locale = "ru"): TrackingContextDraft {
  const currentLocale = normalizedUiLocale(locale);
  const engine = translateUi(currentLocale, base.searchEngine === "YANDEX" ? "Яндекс" : "Google");
  const device = translateUi(currentLocale, target.device === "DESKTOP" ? "Десктоп" : "Мобильное");
  const region = translateUi(
    currentLocale,
    searchRegionDisplayName(
      base.searchEngine,
      target.regionCode,
      target.regionLabel
    )
  );
  const prefix = competitorMode ? `${translateUi(currentLocale, "Конкуренты")} · ` : "";
  return { ...base, ...target, name: `${prefix}${engine} · ${region} · ${device}`.slice(0, 160) };
}

export function rankTargetGroups(targets: readonly RankTarget[]) {
  const groups = new Map<string, { regionCode: string; regionLabel: string; devices: RankTarget["device"][] }>();
  for (const target of targets) {
    const group = groups.get(target.regionCode) ?? { regionCode: target.regionCode, regionLabel: target.regionLabel, devices: [] };
    if (!group.devices.includes(target.device)) group.devices.push(target.device);
    groups.set(target.regionCode, group);
  }
  return [...groups.values()];
}
