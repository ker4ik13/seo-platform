import {
  parseProjectOnboardingSettings,
  trackingDepths,
  type ProjectOnboardingSettings,
  type TrackingDepth,
} from "@seo-platform/contracts";
import type { RankTarget } from "./rank-targets.ts";

export interface ProjectRunPreference {
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly depth: TrackingDepth;
  readonly targets: readonly RankTarget[];
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly yandexLiveMode?: "STANDARD" | "TURBO";
  readonly xmlStockDepthMode?: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
}
export type ProjectRunPreferenceKind = "positions" | "competitors" | "ai";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
interface RecordValue {
  version: 1;
  lastEngine: "YANDEX" | "GOOGLE";
  engines: Partial<
    Record<ProjectRunPreference["searchEngine"], ProjectRunPreference>
  >;
}
function key(
  projectId: string,
  userId: string,
  kind: ProjectRunPreferenceKind,
): string {
  return "seo:project-run:v1:" + userId + ":" + projectId + ":" + kind;
}
function readRecord(
  storage: StorageLike,
  projectId: string,
  userId: string,
  kind: ProjectRunPreferenceKind,
): RecordValue | undefined {
  try {
    const raw = storage.getItem(key(projectId, userId, kind));
    if (!raw || raw.length > 100_000) return undefined;
    const value = JSON.parse(raw) as RecordValue;
    if (
      value.version !== 1 ||
      !["YANDEX", "GOOGLE"].includes(value.lastEngine) ||
      !value.engines
    )
      return undefined;
    const engines: RecordValue["engines"] = {};
    for (const engine of ["YANDEX", "GOOGLE"] as const) {
      const settings = value.engines[engine];
      if (!settings) continue;
      if (
        settings.searchEngine !== engine ||
        !trackingDepths.includes(settings.depth) ||
        (settings.searchSource !== undefined &&
          !["LIVE", "SEARCH_API"].includes(settings.searchSource)) ||
        (settings.yandexLiveMode !== undefined &&
          !["STANDARD", "TURBO"].includes(settings.yandexLiveMode)) ||
        (settings.xmlStockDepthMode !== undefined &&
          !["STRICT_DEPTH", "STOP_AFTER_FOUND"].includes(
            settings.xmlStockDepthMode,
          ))
      )
        return undefined;
      parseProjectOnboardingSettings({
        version: 1,
        engines: [
          {
            searchEngine: engine,
            depth: 30,
            positions: true,
            ai: false,
            targets: settings.targets,
          },
        ],
        columns: ["query"],
        columnOrder: ["query"],
      });
      engines[engine] = settings;
    }
    return engines[value.lastEngine]
      ? { version: 1, lastEngine: value.lastEngine, engines }
      : undefined;
  } catch {
    return undefined;
  }
}
export function readProjectRunPreference(
  storage: StorageLike,
  projectId: string,
  userId: string | undefined,
  kind: ProjectRunPreferenceKind,
  engine?: ProjectRunPreference["searchEngine"],
): ProjectRunPreference | undefined {
  if (!userId) return undefined;
  const value = readRecord(storage, projectId, userId, kind);
  return value?.engines[engine ?? value.lastEngine];
}
export function writeProjectRunPreference(
  storage: StorageLike,
  projectId: string,
  userId: string | undefined,
  kind: ProjectRunPreferenceKind,
  preference: ProjectRunPreference,
): void {
  if (!userId) return;
  try {
    const old = readRecord(storage, projectId, userId, kind);
    const engines = { ...old?.engines, [preference.searchEngine]: preference };
    storage.setItem(
      key(projectId, userId, kind),
      JSON.stringify({
        version: 1,
        lastEngine: preference.searchEngine,
        engines,
      }),
    );
  } catch {
    /* Only an optional preference: server-paid command receipts remain authoritative. */
  }
}
export function onboardingRunPreference(
  settings: ProjectOnboardingSettings | undefined,
  kind: "positions" | "ai",
  searchEngine?: ProjectRunPreference["searchEngine"],
): ProjectRunPreference | undefined {
  const engine = settings?.engines.find(
    (engine) =>
      (kind === "ai" ? engine.ai : engine.positions) &&
      (!searchEngine || engine.searchEngine === searchEngine),
  );
  return engine
    ? {
        searchEngine: engine.searchEngine,
        depth: engine.depth,
        targets: engine.targets,
        searchSource: "LIVE",
      }
    : undefined;
}
