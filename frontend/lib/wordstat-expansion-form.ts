import type {
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { effectiveProjectConnectorOptions } from "./project-integration-settings.ts";

export const wordstatStoredResultSafetyLimit = 10_000;

export type WordstatFormProvider = "XMLSTOCK" | "ARSENKIN";
export type WordstatQueryMode = "TEXT" | "PROJECT";

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
