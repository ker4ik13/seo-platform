import type {
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  effectiveProjectConnectorOptions,
  projectConnectorOptions
} from "./project-integration-settings.ts";

export const wordstatStoredResultSafetyLimit = 10_000;

export type WordstatFormProvider = "XMLSTOCK" | "ARSENKIN";
export type WordstatQueryMode = "TEXT" | "PROJECT";

export interface WordstatExpansionSourceOptions {
  readonly requiresProjectBinding: boolean;
  readonly sources: readonly ProjectConnectorCredentialOption[];
}

export function wordstatScopeIsResolving(
  mode: WordstatQueryMode,
  scopeResolving: boolean
): boolean {
  return mode === "PROJECT" && scopeResolving;
}

export function wordstatResultLimit(
  provider: WordstatFormProvider,
  rawLimit: string
): number | undefined {
  if (provider === "ARSENKIN") return wordstatStoredResultSafetyLimit;
  const value = Number(rawLimit);
  return Number.isInteger(value) &&
    value >= 1 &&
    value <= wordstatStoredResultSafetyLimit
    ? value
    : undefined;
}

export function wordstatExpansionSources(
  project: ProjectConnectorSettings,
  workspace: WorkspaceConnectorRoutingSettings
): readonly ProjectConnectorCredentialOption[] {
  return effectiveProjectConnectorOptions(
    project,
    workspace,
    "KEYWORD_RESEARCH"
  ).filter(
    ({ provider }) => provider === "XMLSTOCK" || provider === "ARSENKIN"
  );
}

export function wordstatExpansionSourceOptions(
  project: ProjectConnectorSettings,
  workspace: WorkspaceConnectorRoutingSettings
): WordstatExpansionSourceOptions {
  const routed = wordstatExpansionSources(project, workspace);
  if (routed.length > 0) {
    return { requiresProjectBinding: false, sources: routed };
  }
  if (
    !project.access.canUpdateBindings ||
    !project.access.canUseSystemCredentials ||
    project.access.mutationRestriction !== "NONE"
  ) {
    return { requiresProjectBinding: false, sources: [] };
  }
  const sources = projectConnectorOptions(project, "KEYWORD_RESEARCH").filter(
    ({ provider, status }) =>
      status === "ACTIVE" &&
      (provider === "XMLSTOCK" || provider === "ARSENKIN")
  );
  return {
    requiresProjectBinding: sources.length > 0,
    sources
  };
}
