"use client";

import type { SemanticRankDimension } from "@seo-platform/contracts";
import { searchRegionDisplayName } from "../lib/seo-regions";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText } from "./ui-locale";

export function SemanticRankContext({
  device,
  regionCode,
  regionLabel,
  searchEngine,
  showEngineName = true
}: Readonly<{
  device: SemanticRankDimension["device"];
  regionCode: string;
  regionLabel?: string;
  searchEngine: SemanticRankDimension["searchEngine"];
  showEngineName?: boolean;
}>) {
  return (
    <span className="semantic-rank-context">
      <SearchEngineLogo engine={searchEngine} size="compact" />
      {showEngineName && (
        <span className="semantic-rank-context-engine">
          {searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}
        </span>
      )}
      <span className="semantic-rank-context-region">
        {rankRegionDisplayName(searchEngine, regionCode, regionLabel)}
      </span>
      <SemanticRankDeviceBadge device={device} />
    </span>
  );
}

export function SemanticRankDeviceBadge({
  device
}: Readonly<{ device: SemanticRankDimension["device"] }>) {
  return (
    <span className="semantic-rank-device-badge">
      <Icon name={device === "DESKTOP" ? "desktop" : "mobile"} />
      <UiText text={device === "DESKTOP" ? "ПК" : "Телефон"} />
    </span>
  );
}

export function rankRegionDisplayName(
  searchEngine: SemanticRankDimension["searchEngine"],
  regionCode: string,
  regionLabel?: string
): string {
  return searchRegionDisplayName(searchEngine, regionCode, regionLabel);
}
