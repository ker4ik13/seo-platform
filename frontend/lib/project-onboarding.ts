import {
  parseProjectOnboardingSettings,
  projectOnboardingBaseColumns,
  projectOnboardingColumnCatalog,
  projectOnboardingDimensions,
  projectOnboardingSystemColumns,
  semanticRankColumnKey,
  type CreateProjectInput,
  type ProjectOnboardingEngine,
  type ProjectOnboardingSettings,
  type SemanticSavedViewColumnKey,
} from "@seo-platform/contracts";
import { defaultSemanticSearchRegions } from "./semantic-region-preference.ts";

export interface ProjectOnboardingDraft {
  readonly version: 1;
  readonly step?: 1 | 2 | 3;
  readonly name: string;
  readonly domain: string;
  readonly engines: readonly ProjectOnboardingEngine[];
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly columnOrder: readonly SemanticSavedViewColumnKey[];
  readonly urls: boolean;
  readonly dates: boolean;
  readonly confirmDuplicateDomain: boolean;
  readonly pending?: Readonly<{ key: string; body: CreateProjectInput }>;
}
export function newProjectOnboardingDraft(): ProjectOnboardingDraft {
  const regions = defaultSemanticSearchRegions();
  return {
    version: 1,
    name: "",
    domain: "",
    urls: false,
    dates: false,
    confirmDuplicateDomain: false,
    visibility: {},
    columnOrder: [],
    engines: [
      {
        searchEngine: "YANDEX",
        positions: true,
        ai: false,
        depth: 30,
        targets: [
          {
            regionCode: regions.YANDEX.code,
            regionLabel: regions.YANDEX.label,
            device: "DESKTOP",
          },
        ],
      },
      {
        searchEngine: "GOOGLE",
        positions: false,
        ai: false,
        depth: 30,
        targets: [
          {
            regionCode: regions.GOOGLE.code,
            regionLabel: regions.GOOGLE.label,
            device: "DESKTOP",
          },
        ],
      },
    ],
  };
}
export function onboardingColumnSelection(draft: ProjectOnboardingDraft) {
  const engines = draft.engines.filter(
    (engine) => engine.positions || engine.ai,
  );
  const dynamic = engines.flatMap((engine) =>
    projectOnboardingDimensions({ engines: [engine] }).flatMap((dimension) => [
      ...(engine.positions
        ? [
            semanticRankColumnKey(dimension.key, "position"),
            ...(draft.urls
              ? [semanticRankColumnKey(dimension.key, "url")]
              : []),
            ...(draft.dates
              ? [semanticRankColumnKey(dimension.key, "checkedAt")]
              : []),
          ]
        : []),
      ...(engine.ai
        ? [
            semanticRankColumnKey(dimension.key, "aiPosition"),
            ...(draft.urls
              ? [semanticRankColumnKey(dimension.key, "aiUrl")]
              : []),
            ...(draft.dates
              ? [semanticRankColumnKey(dimension.key, "aiCheckedAt")]
              : []),
          ]
        : []),
    ]),
  );
  const catalog = projectOnboardingColumnCatalog({ engines });
  const preferred = [
    ...projectOnboardingBaseColumns,
    ...dynamic,
    ...projectOnboardingSystemColumns,
  ];
  const order = [
    "query" as const,
    ...new Set([
      ...draft.columnOrder.filter(
        (key) => key !== "query" && catalog.includes(key),
      ),
      ...preferred.filter((key) => key !== "query"),
      ...catalog.filter((key) => key !== "query"),
    ]),
  ];
  const initial = new Set<SemanticSavedViewColumnKey>([
    ...projectOnboardingBaseColumns,
    ...dynamic,
  ]);
  const columns = order.filter(
    (key) => key === "query" || (draft.visibility[key] ?? initial.has(key)),
  );
  return { columns, columnOrder: order };
}
export function projectOnboardingSettings(
  draft: ProjectOnboardingDraft,
): ProjectOnboardingSettings {
  return parseProjectOnboardingSettings({
    version: 1,
    engines: draft.engines.filter((engine) => engine.positions || engine.ai),
    ...onboardingColumnSelection(draft),
  });
}
export function projectOnboardingFields(
  draft: ProjectOnboardingDraft,
): Readonly<{ name?: string; domain?: string }> {
  const domain = draft.domain.trim();
  return {
    ...(!draft.name.trim() ? { name: "Введите название проекта" } : {}),
    ...(!domain ||
    domain.length > 253 ||
    domain.includes("://") ||
    /[/:\s?@#]/u.test(domain) ||
    domain.split(".").length < 2 ||
    domain
      .split(".")
      .some(
        (label) =>
          !label || label.length > 63 || /^-|-$|[^а-яёa-z0-9-]/iu.test(label),
      )
      ? { domain: "Укажите домен без протокола, пути и порта" }
      : {}),
  };
}
export function readProjectOnboardingDraft(
  storage: Pick<Storage, "getItem">,
  userId: string,
  workspaceId: string,
): ProjectOnboardingDraft | undefined {
  const value = storage.getItem(projectOnboardingDraftKey(userId, workspaceId));
  if (!value || value.length > 150_000) return undefined;
  try {
    const draft = JSON.parse(value) as ProjectOnboardingDraft;
    if (
      draft.version !== 1 ||
      typeof draft.name !== "string" ||
      draft.name.length > 160 ||
      typeof draft.domain !== "string" ||
      draft.domain.length > 255 ||
      !Array.isArray(draft.engines) ||
      draft.engines.length !== 2 ||
      typeof draft.urls !== "boolean" ||
      typeof draft.dates !== "boolean" ||
      typeof draft.confirmDuplicateDomain !== "boolean" ||
      !draft.visibility ||
      typeof draft.visibility !== "object" ||
      Object.entries(draft.visibility).some(
        ([key, value]) => key.length > 1000 || typeof value !== "boolean",
      ) ||
      !Array.isArray(draft.columnOrder)
    )
      return undefined;
    // Include disabled engines in the same shared validator so their targets
    // cannot become invalid or unbounded while the draft is saved.
    if (
      new Set(draft.engines.map((engine) => engine.searchEngine)).size !== 2 ||
      draft.engines.some(
        (engine) =>
          typeof engine.positions !== "boolean" ||
          typeof engine.ai !== "boolean",
      )
    )
      return undefined;
    for (const engine of draft.engines) {
      parseProjectOnboardingSettings({
        version: 1,
        engines: [{ ...engine, positions: true }],
        columns: projectOnboardingBaseColumns,
        columnOrder: projectOnboardingBaseColumns,
      });
    }
    if (draft.pending) {
      if (
        !/^project-onboarding:[0-9a-f-]{36}$/iu.test(draft.pending.key) ||
        draft.pending.body.name !== draft.name.trim() ||
        draft.pending.body.domain !== draft.domain.trim() ||
        !draft.pending.body.onboarding
      )
        return undefined;
      parseProjectOnboardingSettings(draft.pending.body.onboarding);
    }
    return draft;
  } catch {
    return undefined;
  }
}
export function projectOnboardingDraftKey(
  userId: string,
  workspaceId: string,
): string {
  return "seo:project-onboarding:v1:" + userId + ":" + workspaceId;
}
