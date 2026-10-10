import {
  parseSemanticRankDimensionKey,
  projectPositionTopThresholds,
  type ProjectOnboardingSettings,
} from "@seo-platform/contracts";
import {
  onboardingRunPreference,
  readProjectRunPreference,
} from "./project-run-defaults.ts";

export function projectChartDefaultTops(
  settings: ProjectOnboardingSettings | undefined,
  dimensionKey: string,
  projectId: string,
  userId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const dimension = parseSemanticRankDimensionKey(dimensionKey);
  if (!dimension) return projectPositionTopThresholds;
  const last = readProjectRunPreference(
    storage,
    projectId,
    userId,
    "positions",
    dimension.searchEngine,
  );
  const planned = onboardingRunPreference(
    settings,
    "positions",
    dimension.searchEngine,
  );
  const selected = [last, planned].find((value) =>
    value?.targets.some(
      (target) =>
        target.regionCode === dimension.regionCode &&
        target.device === dimension.device,
    ),
  );
  return selected
    ? projectPositionTopThresholds.filter((top) => top <= selected.depth)
    : projectPositionTopThresholds;
}
