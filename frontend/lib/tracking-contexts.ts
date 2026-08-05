import type {
  CreateTrackingContextInput,
  TrackingContextMutationRestriction,
  TrackingContextSettings,
  TrackingContextSummary,
  TrackingDepth,
  TrackingDevice,
  TrackingDomainMatchMode,
  TrackingSearchEngine
} from "@seo-platform/contracts";

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
}

export type TrackingContextDraftField =
  | "name"
  | "countryCode"
  | "regionCode"
  | "regionLabel"
  | "language"
  | "domainMatchValue";

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
    safeSearch: false
  };
}

export function trackingContextDraft(
  context: TrackingContextSummary
): TrackingContextDraft {
  const rule = context.configuration.domainMatchRule;
  return {
    name: context.name,
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
    safeSearch: context.configuration.safeSearch
  };
}

export function trackingContextCreateInput(
  draft: TrackingContextDraft
): CreateTrackingContextInput {
  return trackingContextMutationInput(draft);
}

export function trackingContextPayloadSignature(
  draft: TrackingContextDraft
): string {
  return JSON.stringify(trackingContextCreateInput(draft));
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
