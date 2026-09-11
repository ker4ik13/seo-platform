"use client";
import { rankTargetGroups, rankTargetLimit, uniqueRankTargets, type RankTarget } from "../lib/rank-targets";
import { searchRegionDisplayName } from "../lib/seo-regions";
import { SearchableRegionSelect } from "./searchable-region-select";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticRankTargets({ targets, engine, disabled = false, onChange }: {
  targets: readonly RankTarget[];
  engine: "YANDEX" | "GOOGLE";
  disabled?: boolean;
  onChange: (targets: readonly RankTarget[]) => void;
}) {
  const { t } = useUiLocale();
  const groups = rankTargetGroups(targets).map((group) => ({
    ...group,
    regionLabel: searchRegionDisplayName(
      engine,
      group.regionCode,
      group.regionLabel
    )
  }));
  const kind = engine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK";
  return <fieldset className="semantic-rank-targets" disabled={disabled}>
    <legend><UiText text="Города и устройства" /></legend>
    <p><UiText text="Для каждого города выберите ПК, телефон или оба устройства." /></p>
    <div className="semantic-rank-target-list">
      {groups.map(group => <div className="semantic-rank-target" key={group.regionCode}>
        <div className="semantic-rank-target-city">
          <SearchableRegionSelect kind={kind} value={group.regionCode} valueLabel={group.regionLabel} onChange={({ code, label }) => onChange(uniqueRankTargets(targets.map(target => target.regionCode === group.regionCode ? { ...target, regionCode: code, regionLabel: label } : target)))} />
          <button type="button" disabled={groups.length === 1} aria-label={t("Убрать город «{0}»", [group.regionLabel])} onClick={() => onChange(targets.filter(target => target.regionCode !== group.regionCode))}><Icon name="close" /></button>
        </div>
        <div className="semantic-rank-target-devices" role="group" aria-label={t("Устройства · {0}", [group.regionLabel])}>
          {(["DESKTOP", "MOBILE"] as const).map(device => {
            const checked = group.devices.includes(device);
            return <label key={device} className={checked ? "selected" : undefined}>
              <input type="checkbox" checked={checked} disabled={(checked && group.devices.length === 1) || (!checked && targets.length >= rankTargetLimit)} onChange={() => onChange(checked ? targets.filter(target => target.regionCode !== group.regionCode || target.device !== device) : uniqueRankTargets([...targets, { regionCode: group.regionCode, regionLabel: group.regionLabel, device }]))} />
              <Icon name={device === "DESKTOP" ? "desktop" : "mobile"} /><UiText text={device === "DESKTOP" ? "ПК" : "Телефон"} />
            </label>;
          })}
        </div>
      </div>)}
    </div>
    {targets.length < rankTargetLimit && <div className="semantic-rank-target-add">
      <span><Icon name="plus" /><UiText text="Добавить город" /></span>
      <SearchableRegionSelect kind={kind} value="" onChange={({ code, label }) => onChange(uniqueRankTargets([...targets, { regionCode: code, regionLabel: label, device: "DESKTOP" }]))} />
    </div>}
    <small><UiText text="Отдельных съёмов: {0}. Результаты сохранятся по каждому городу и устройству." values={[String(targets.length)]} /></small>
  </fieldset>;
}
