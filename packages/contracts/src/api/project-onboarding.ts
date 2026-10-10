import {
  parseSemanticRankColumnKey,
  semanticRankColumnKey,
  semanticRankDimensionKey,
  type SemanticRankDimension,
} from "./rank-dimensions.js";
import {
  semanticSavedViewCurrentSchemaVersion,
  semanticSavedViewColumnOrderLimit,
  semanticSavedViewQueryIndicators,
  semanticSystemColumnKeys,
  type SemanticSavedViewColumnKey,
  type SemanticSavedViewConfig,
} from "./semantic-saved-views.js";

export interface ProjectOnboardingTarget {
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly device: "DESKTOP" | "MOBILE";
}
export interface ProjectOnboardingEngine {
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly positions: boolean;
  readonly ai: boolean;
  readonly depth: 10 | 30 | 50 | 100;
  readonly targets: readonly ProjectOnboardingTarget[];
}
/** Immutable starting template, not a copy of mutable personal views. */
export interface ProjectOnboardingSettings {
  readonly version: 1;
  readonly engines: readonly ProjectOnboardingEngine[];
  readonly columns: readonly SemanticSavedViewColumnKey[];
  readonly columnOrder: readonly SemanticSavedViewColumnKey[];
}
export interface InternalInitializeProjectOnboardingInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly canManageShared: boolean;
  readonly settings: ProjectOnboardingSettings;
}
export interface ProjectOnboardingInitialization {
  readonly projectId: string;
  readonly initialized: true;
  readonly trackingContextCount: number;
  readonly viewId: string;
}
export const projectOnboardingMaxTargets = 64;
export const projectOnboardingHiddenColumns = [
  "wordCount",
  "group",
  "tags",
  "source",
] as const;
export const projectOnboardingBaseColumns = [
  "query",
  "frequency",
  "frequencyExact",
  "frequencyFixed",
] as const;
export const projectOnboardingSystemColumns = semanticSystemColumnKeys.filter(
  (key) => !/^(yandex|google)/u.test(key),
);

export function projectOnboardingDimensions(
  settings: Pick<ProjectOnboardingSettings, "engines">,
): readonly SemanticRankDimension[] {
  const dimensions = settings.engines.flatMap((engine) =>
    engine.targets.map((target) => {
      const value = {
        searchEngine: engine.searchEngine,
        countryCode: "RU",
        language: "ru",
        ...target,
      };
      return { key: semanticRankDimensionKey(value), ...value };
    }),
  );
  return [
    ...new Map(
      dimensions.map((dimension) => [dimension.key, dimension]),
    ).values(),
  ];
}
export function projectOnboardingColumnCatalog(
  settings: Pick<ProjectOnboardingSettings, "engines">,
): readonly SemanticSavedViewColumnKey[] {
  return [
    ...projectOnboardingSystemColumns,
    ...settings.engines.flatMap((engine) =>
      projectOnboardingDimensions({ engines: [engine] }).flatMap(
        (dimension) => [
          ...(engine.positions
            ? (["position", "url", "checkedAt"] as const).map((metric) =>
                semanticRankColumnKey(dimension.key, metric),
              )
            : []),
          ...(engine.ai
            ? (["aiPosition", "aiUrl", "aiCheckedAt"] as const).map((metric) =>
                semanticRankColumnKey(dimension.key, metric),
              )
            : []),
        ],
      ),
    ),
  ];
}
export function projectOnboardingViewConfig(
  settings: ProjectOnboardingSettings,
): Omit<SemanticSavedViewConfig, "columnWidths"> {
  return {
    schemaVersion: semanticSavedViewCurrentSchemaVersion,
    filters: {},
    sort: "CREATED_DESC",
    density: "COMFORTABLE",
    columns: settings.columns,
    columnOrder: settings.columnOrder,
    queryIndicators: semanticSavedViewQueryIndicators,
    pageSize: 200,
  };
}
export function parseProjectOnboardingSettings(
  value: unknown,
): ProjectOnboardingSettings {
  const row = exact(value, ["version", "engines", "columns", "columnOrder"]);
  if (
    row.version !== 1 ||
    !Array.isArray(row.engines) ||
    row.engines.length > 2
  )
    invalid();
  const engines: ProjectOnboardingEngine[] = row.engines.map((value) => {
    const engine = exact(value, [
      "searchEngine",
      "positions",
      "ai",
      "depth",
      "targets",
    ]);
    if (
      !["YANDEX", "GOOGLE"].includes(String(engine.searchEngine)) ||
      typeof engine.positions !== "boolean" ||
      typeof engine.ai !== "boolean" ||
      (!engine.positions && !engine.ai) ||
      ![10, 30, 50, 100].includes(Number(engine.depth)) ||
      typeof engine.depth !== "number" ||
      !Array.isArray(engine.targets) ||
      !engine.targets.length ||
      engine.targets.length > projectOnboardingMaxTargets
    )
      invalid();
    const targets = engine.targets.map((value) => {
      const target = exact(value, ["regionCode", "regionLabel", "device"]);
      if (
        typeof target.regionCode !== "string" ||
        !/^\d{1,10}$/u.test(target.regionCode) ||
        typeof target.regionLabel !== "string" ||
        !target.regionLabel.trim() ||
        target.regionLabel.length > 160 ||
        [...target.regionLabel].some(
          (character) =>
            character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
        ) ||
        !["DESKTOP", "MOBILE"].includes(String(target.device))
      )
        invalid();
      return {
        regionCode: target.regionCode,
        regionLabel: target.regionLabel.trim(),
        device: target.device as ProjectOnboardingTarget["device"],
      };
    });
    if (
      new Set(targets.map((target) => target.regionCode + ":" + target.device))
        .size !== targets.length
    )
      invalid();
    return {
      searchEngine:
        engine.searchEngine as ProjectOnboardingEngine["searchEngine"],
      positions: engine.positions,
      ai: engine.ai,
      depth: engine.depth as ProjectOnboardingEngine["depth"],
      targets,
    };
  });
  if (
    new Set(engines.map((engine) => engine.searchEngine)).size !==
      engines.length ||
    engines.reduce((count, engine) => count + engine.targets.length, 0) >
      projectOnboardingMaxTargets
  )
    invalid();
  const catalog = new Set(projectOnboardingColumnCatalog({ engines }));
  const columns = columnList(row.columns, catalog, 128);
  const columnOrder = columnList(row.columnOrder, catalog, semanticSavedViewColumnOrderLimit);
  if (
    columns[0] !== "query" ||
    columnOrder[0] !== "query" ||
    columns.some((key) => !columnOrder.includes(key)) ||
    !sameOrder(
      columns,
      columnOrder.filter((key) => columns.includes(key)),
    )
  )
    invalid();
  return { version: 1, engines, columns, columnOrder };
}
export function parseInternalInitializeProjectOnboardingInput(
  value: unknown,
): InternalInitializeProjectOnboardingInput {
  const row = exact(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "canManageShared",
    "settings",
  ]);
  if (typeof row.canManageShared !== "boolean") invalid();
  return {
    workspaceId: uuid(row.workspaceId),
    projectId: uuid(row.projectId),
    actorId: uuid(row.actorId),
    canManageShared: row.canManageShared,
    settings: parseProjectOnboardingSettings(row.settings),
  };
}
export function parseProjectOnboardingInitialization(
  value: unknown,
  projectId: string,
): ProjectOnboardingInitialization {
  const row = exact(value, [
    "projectId",
    "initialized",
    "trackingContextCount",
    "viewId",
  ]);
  if (
    uuid(row.projectId) !== projectId ||
    row.initialized !== true ||
    !Number.isSafeInteger(row.trackingContextCount) ||
    Number(row.trackingContextCount) < 0 ||
    Number(row.trackingContextCount) > projectOnboardingMaxTargets
  )
    invalid();
  return {
    projectId,
    initialized: true,
    trackingContextCount: Number(row.trackingContextCount),
    viewId: uuid(row.viewId),
  };
}
function columnList(
  value: unknown,
  catalog: ReadonlySet<string>,
  maximum: number,
): SemanticSavedViewColumnKey[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maximum ||
    new Set(value).size !== value.length ||
    value.some(
      (key) =>
        typeof key !== "string" ||
        !catalog.has(key) ||
        (key.startsWith("rank:") && !parseSemanticRankColumnKey(key)),
    )
  )
    invalid();
  return value as SemanticSavedViewColumnKey[];
}
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
function exact(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}
function invalid(): never {
  throw new TypeError("Invalid project onboarding settings");
}
