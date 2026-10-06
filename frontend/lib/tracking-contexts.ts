import type {
  CreateTrackingContextInput,
  TrackingContextMutationRestriction,
  TrackingContextSettings,
  TrackingContextSummary,
  TrackingContextScopeMode,
  TrackingDepth,
  TrackingDevice,
  TrackingDomainMatchMode,
  TrackingSearchEngine,
  TrackingSearchSource
} from "@seo-platform/contracts";
import { searchContextDisplayName } from "./seo-regions.ts";

export const trackingContextsChangedEvent = "tracking-contexts:changed";

export function announceTrackingContextsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(trackingContextsChangedEvent));
  }
}

export interface TrackingContextDraft {
  readonly name: string;
  readonly searchEngine: TrackingSearchEngine;
  readonly countryCode: string;
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly language: string;
  readonly device: TrackingDevice;
  readonly depth: TrackingDepth;
  readonly domainMatchMode: TrackingDomainMatchMode;
  readonly domainMatchValue: string;
  readonly safeSearch: boolean;
  readonly searchSource: TrackingSearchSource;
  readonly yandexLiveMode: "STANDARD" | "TURBO";
  readonly xmlStockDepthMode: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
  readonly includeUntracked: boolean;
  readonly scopeMode: TrackingContextScopeMode;
  readonly groupIds: readonly string[];
  readonly descendantGroupIds: readonly string[];
}

export type TrackingContextDraftField =
  | "name"
  | "countryCode"
  | "regionCode"
  | "regionLabel"
  | "language"
  | "domainMatchValue"
  | "scopeMode";

export type TrackingContextDraftErrors = Readonly<
  Partial<Record<TrackingContextDraftField, string>>
>;

export interface TrackingContextCreateReconciliation {
  readonly current: TrackingContextSummary;
  readonly superseded: boolean;
}

export interface TrackingContextEditorRevision {
  readonly base: TrackingContextSummary;
  readonly draft: TrackingContextDraft;
}

export function emptyTrackingContextDraft(): TrackingContextDraft {
  return {
    name: "",
    searchEngine: "GOOGLE",
    countryCode: "",
    regionCode: "",
    regionLabel: "",
    language: "",
    device: "DESKTOP",
    depth: 100,
    domainMatchMode: "EXACT_HOST",
    domainMatchValue: "",
    safeSearch: false,
    searchSource: "LIVE",
    yandexLiveMode: "STANDARD",
    xmlStockDepthMode: "STRICT_DEPTH",
    includeUntracked: false,
    scopeMode: "KEYWORDS",
    groupIds: [],
    descendantGroupIds: []
  };
}

export function defaultTrackingContextSettingsDraft(): TrackingContextDraft {
  return {
    ...emptyTrackingContextDraft(),
    name: "Москва · Десктоп",
    searchEngine: "YANDEX",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 50,
    scopeMode: "GROUPS",
    groupIds: []
  };
}

export function trackingContextDraft(
  context: TrackingContextSummary
): TrackingContextDraft {
  const rule = context.configuration.domainMatchRule;
  return {
    name: trackingContextDisplayName(context),
    searchEngine: context.configuration.searchEngine,
    countryCode: context.configuration.countryCode,
    regionCode: context.configuration.regionCode ?? "",
    regionLabel: context.configuration.regionLabel ?? "",
    language: context.configuration.language,
    device: context.configuration.device,
    depth: context.configuration.depth,
    domainMatchMode: rule.mode,
    domainMatchValue:
      rule.mode === "SPECIFIC_URL" || rule.mode === "URL_PREFIX"
        ? rule.value
        : "",
    safeSearch: context.configuration.safeSearch,
    searchSource: context.launchProfile?.searchSource ?? "LIVE",
    yandexLiveMode: context.launchProfile?.yandexLiveMode ?? "STANDARD",
    xmlStockDepthMode:
      context.launchProfile?.xmlStockDepthMode ?? "STRICT_DEPTH",
    includeUntracked: context.launchProfile?.includeUntracked ?? false,
    scopeMode: context.launchProfile?.scope.mode ?? "ALL",
    groupIds: context.launchProfile?.scope.groupIds ?? [],
    descendantGroupIds:
      context.launchProfile?.scope.mode === "GROUPS"
        ? context.launchProfile.scope.descendantGroupIds ??
          (context.launchProfile.scope.includeDescendants ?? true
            ? context.launchProfile.scope.groupIds
            : [])
        : []
  };
}

export function trackingContextDisplayName(
  context: Pick<TrackingContextSummary, "name" | "configuration">
): string {
  return searchContextDisplayName(
    context.name,
    context.configuration.searchEngine,
    context.configuration.regionCode,
    context.configuration.regionLabel
  );
}

export function trackingContextCreateInput(
  draft: TrackingContextDraft,
  options: Readonly<{ isReusable?: boolean }> = {}
): CreateTrackingContextInput {
  return {
    ...trackingContextMutationInput(draft),
    ...(options.isReusable === undefined
      ? {}
      : { isReusable: options.isReusable })
  };
}

export function trackingContextPayloadSignature(
  draft: TrackingContextDraft,
  options: Readonly<{ isReusable?: boolean }> = {}
): string {
  return JSON.stringify(trackingContextCreateInput(draft, options));
}

export function trackingContextDraftDirty(
  context: TrackingContextSummary | undefined,
  draft: TrackingContextDraft
): boolean {
  const base = context
    ? trackingContextDraft(context)
    : emptyTrackingContextDraft();
  return (
    trackingContextPayloadSignature(base) !==
    trackingContextPayloadSignature(draft)
  );
}

/** Running an existing profile may update its parameters, never its stored name. */
export function trackingContextLaunchDraft(
  context: TrackingContextSummary,
  draft: TrackingContextDraft
): TrackingContextDraft {
  return { ...draft, name: context.name };
}

export function trackingContextMatchesDraft(
  context: TrackingContextSummary,
  draft: TrackingContextDraft
): boolean {
  return (
    trackingContextPayloadSignature(trackingContextDraft(context)) ===
    trackingContextPayloadSignature(draft)
  );
}

export function validateTrackingContextDraft(
  draft: TrackingContextDraft
): TrackingContextDraftErrors {
  const errors: Partial<
    Record<TrackingContextDraftField, string>
  > = {};
  const name = normalizedText(draft.name);
  if (!name) {
    errors.name = "Введите название контекста.";
  } else if (name.length > 160) {
    errors.name = "Название должно содержать не более 160 символов.";
  }

  const country = draft.countryCode.trim();
  if (!/^[A-Za-z]{2}$/u.test(country)) {
    errors.countryCode = "Укажите двухбуквенный код страны, например US.";
  }

  const language = canonicalLanguage(draft.language);
  if (!language || language.length > 16) {
    errors.language = "Укажите язык в формате BCP 47, например en или ru-RU.";
  }

  const regionCode = normalizedText(draft.regionCode);
  const regionLabel = normalizedText(draft.regionLabel);
  if (regionCode.length > 100) {
    errors.regionCode = "Код региона должен содержать не более 100 символов.";
  }
  if (regionLabel && !regionCode) {
    errors.regionLabel =
      "Название региона можно указать только вместе с каноническим кодом.";
  } else if (regionLabel.length > 160) {
    errors.regionLabel =
      "Название региона должно содержать не более 160 символов.";
  }

  if (domainMatchNeedsValue(draft.domainMatchMode)) {
    const value = draft.domainMatchValue.trim();
    if (!value) {
      errors.domainMatchValue = "Укажите URL для выбранного правила.";
    } else if (value.length > 2048 || !isAllowedTrackingUrl(value)) {
      errors.domainMatchValue =
        "Укажите полный http(s) URL без логина, пароля и #fragment, длиной до 2048 символов.";
    }
  }
  if (draft.scopeMode === "GROUPS" && draft.groupIds.length === 0) {
    errors.scopeMode = "Выберите хотя бы одну папку для этого контекста.";
  }
  return errors;
}

export function domainMatchNeedsValue(
  mode: TrackingDomainMatchMode
): boolean {
  return mode === "SPECIFIC_URL" || mode === "URL_PREFIX";
}

export function withTrackingContext(
  settings: TrackingContextSettings,
  context: TrackingContextSummary
): TrackingContextSettings {
  const index = settings.contexts.findIndex(
    (candidate) => candidate.id === context.id
  );
  if (index < 0) {
    const contexts = [context, ...settings.contexts];
    return {
      ...settings,
      contexts:
        settings.contextsTruncated && settings.contexts.length > 0
          ? contexts.slice(0, settings.contexts.length)
          : contexts
    };
  }
  return {
    ...settings,
    contexts: settings.contexts.map((candidate) =>
      candidate.id === context.id ? context : candidate
    )
  };
}

export function sameTrackingContextRevision(
  left: TrackingContextSummary,
  right: TrackingContextSummary
): boolean {
  return left.id === right.id && left.version === right.version;
}

export function reconcileTrackingContextCreate(
  receipt: TrackingContextSummary,
  authoritative: TrackingContextSummary
): TrackingContextCreateReconciliation {
  if (
    receipt.id !== authoritative.id ||
    receipt.workspaceId !== authoritative.workspaceId ||
    receipt.projectId !== authoritative.projectId ||
    authoritative.version < receipt.version
  ) {
    throw new Error(
      "Created tracking context is missing from authoritative detail"
    );
  }
  return {
    current: authoritative,
    superseded: !sameTrackingContextRevision(receipt, authoritative)
  };
}

export function reconcileTrackingContextEditorRevision(
  editor: TrackingContextEditorRevision,
  server: TrackingContextSummary
): TrackingContextEditorRevision | undefined {
  if (editor.base.id !== server.id) return editor;
  if (server.status === "ARCHIVED") return undefined;
  return {
    base: server,
    draft: trackingContextDraftDirty(editor.base, editor.draft)
      ? editor.draft
      : trackingContextDraft(server)
  };
}

export function effectiveTrackingContextRestriction(
  settings: TrackingContextSettings,
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED",
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED",
  runtimeRestriction?: TrackingContextMutationRestriction
): TrackingContextMutationRestriction {
  if (runtimeRestriction) return runtimeRestriction;
  if (settings.access.mutationRestriction !== "NONE") {
    return settings.access.mutationRestriction;
  }
  if (!settings.access.canConfigure) return "MISSING_PERMISSION";
  if (projectStatus === "ARCHIVED") return "PROJECT_ARCHIVED";
  if (workspaceStatus !== "ACTIVE") return "WORKSPACE_READ_ONLY";
  return "NONE";
}

export function trackingContextsApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`;
}

export function trackingContextApiPath(
  projectId: string,
  contextId: string
): string {
  return `${trackingContextsApiPath(projectId)}/${encodeURIComponent(contextId)}`;
}

export function trackingContextsReturnTo(projectId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`;
}

/**
 * Keeps the three launch-profile states separate even though both a one-off
 * launch and an unsaved profile use an empty public context id. A state change
 * must remount the scope picker so ALL/GROUPS are resolved from the server
 * again instead of retaining the previous picker's empty selection.
 */
export function trackingContextScopeResolutionKey(
  selectedContextId: string,
  createSavedContext: boolean
): string {
  if (createSavedContext) return "new-context";
  return selectedContextId
    ? `saved-context:${selectedContextId}`
    : "one-off-context";
}

export function shouldLoadTrackingContextAssignments(
  selectedContextId: string,
  createSavedContext: boolean
): boolean {
  return Boolean(selectedContextId) && !createSavedContext;
}

function trackingContextMutationInput(
  draft: TrackingContextDraft
): CreateTrackingContextInput {
  const mode = draft.domainMatchMode;
  const language = canonicalLanguage(draft.language);
  return {
    name: normalizedText(draft.name),
    configuration: {
      searchEngine: draft.searchEngine,
      countryCode: draft.countryCode.trim().toUpperCase(),
      ...(normalizedText(draft.regionCode)
        ? { regionCode: normalizedText(draft.regionCode) }
        : {}),
      ...(normalizedText(draft.regionLabel)
        ? { regionLabel: normalizedText(draft.regionLabel) }
        : {}),
      language: language ?? draft.language.trim(),
      device: draft.device,
      depth: draft.depth,
      domainMatchRule: trackingDomainMatchRule(
        mode,
        draft.domainMatchValue
      ),
      safeSearch: draft.safeSearch
    },
    launchProfile: {
      searchSource: draft.searchSource,
      ...(draft.yandexLiveMode === "TURBO"
        ? { yandexLiveMode: "TURBO" as const }
        : {}),
      xmlStockDepthMode: draft.xmlStockDepthMode,
      includeUntracked: draft.includeUntracked,
      scope: {
        mode: draft.scopeMode,
        groupIds:
          draft.scopeMode === "GROUPS"
            ? [...new Set(draft.groupIds)].sort()
            : [],
        descendantGroupIds:
          draft.scopeMode === "GROUPS"
            ? [...new Set(draft.descendantGroupIds)]
                .filter((groupId) => draft.groupIds.includes(groupId))
                .sort()
            : []
      }
    }
  };
}

function trackingDomainMatchRule(
  mode: TrackingDomainMatchMode,
  value: string
): import("@seo-platform/contracts").TrackingDomainMatchRule {
  if (mode === "SPECIFIC_URL" || mode === "URL_PREFIX") {
    return {
      mode,
      value: value.trim()
    };
  }
  return { mode };
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function canonicalLanguage(value: string): string | undefined {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return undefined;
  try {
    return Intl.getCanonicalLocales(normalized)[0];
  } catch {
    return undefined;
  }
}

function isAllowedTrackingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}
