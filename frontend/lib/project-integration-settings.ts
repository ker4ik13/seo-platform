import type {
  CreateProjectConnectorBindingInput,
  IntegrationCapability,
  ProjectConnectorBinding,
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  UpdateProjectConnectorBindingInput,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  type IdempotentCommand,
  stableIdempotencyCommand
} from "./idempotency.ts";

export const RANK_TRACKING_CAPABILITY =
  "SERP_RANK_TRACKING" as const satisfies IntegrationCapability;

export interface ProjectConnectorDraft {
  readonly credentialId: string;
  readonly enabled: boolean;
}

export type IdempotentCreateCommand = IdempotentCommand;

export interface ProjectConnectorCreateReconciliation {
  readonly current: ProjectConnectorBinding;
  readonly superseded: boolean;
}

export function projectConnectorBinding(
  settings: ProjectConnectorSettings,
  capability: IntegrationCapability
): ProjectConnectorBinding | undefined {
  const matches = settings.bindings.filter(
    (binding) => binding.capability === capability
  );
  if (matches.length > 1) {
    throw new Error("Project connector settings contain duplicate capabilities");
  }
  return matches[0];
}

export function projectConnectorDraft(
  binding: ProjectConnectorBinding | undefined
): ProjectConnectorDraft {
  return {
    credentialId: binding?.route?.credentialId ?? "",
    enabled: binding?.enabled ?? true
  };
}

export function sameProjectConnectorBindingRevision(
  left: ProjectConnectorBinding | undefined,
  right: ProjectConnectorBinding | undefined
): boolean {
  if (!left || !right) return left === right;
  return left.id === right.id && left.version === right.version;
}

export function canApplyProjectConnectorRevalidation(
  startedGeneration: number,
  currentGeneration: number,
  startedBinding: ProjectConnectorBinding | undefined,
  currentBinding: ProjectConnectorBinding | undefined
): boolean {
  return (
    startedGeneration === currentGeneration &&
    sameProjectConnectorBindingRevision(startedBinding, currentBinding)
  );
}

export function reconcileProjectConnectorCreate(
  receipt: ProjectConnectorBinding,
  authoritativeSettings: ProjectConnectorSettings,
  capability: IntegrationCapability
): ProjectConnectorCreateReconciliation {
  const current = projectConnectorBinding(
    authoritativeSettings,
    capability
  );
  if (
    receipt.capability !== capability ||
    !current ||
    current.id !== receipt.id ||
    current.workspaceId !== receipt.workspaceId ||
    current.projectId !== receipt.projectId ||
    current.version < receipt.version
  ) {
    throw new Error(
      "Created project connector binding is missing from authoritative settings"
    );
  }
  return {
    current,
    superseded: !sameProjectConnectorBindingRevision(receipt, current)
  };
}

export function withProjectConnectorBinding(
  settings: ProjectConnectorSettings,
  binding: ProjectConnectorBinding
): ProjectConnectorSettings {
  return {
    ...settings,
    bindings: [
      ...settings.bindings.filter(
        (candidate) =>
          candidate.id !== binding.id &&
          candidate.capability !== binding.capability
      ),
      binding
    ]
  };
}

export function projectConnectorOptions(
  settings: ProjectConnectorSettings,
  capability: IntegrationCapability
): readonly ProjectConnectorCredentialOption[] {
  return settings.credentialOptions.filter(
    (credential) =>
      credentialModeSupportsCapability(credential.mode, capability) &&
      credential.capabilities.includes(capability)
  );
}

/**
 * Returns the currently executable route in route order. Inherited project
 * bindings are materialized asynchronously, so the workspace route is the
 * authoritative source for them and prevents a newly added fallback from
 * being hidden by a stale project projection.
 */
export function effectiveProjectConnectorOptions(
  settings: ProjectConnectorSettings,
  workspace: WorkspaceConnectorRoutingSettings,
  capability: IntegrationCapability
): readonly ProjectConnectorCredentialOption[] {
  const binding = projectConnectorBinding(settings, capability);
  if (binding && !binding.enabled) return [];
  const storedProjectRoutes = binding?.routes ??
    (binding?.route ? [binding.route] : []);
  const workspaceBinding = workspace.bindings.find(
    (candidate) => candidate.capability === capability
  );
  const routeIds =
    binding?.configurationScope === "PROJECT_OVERRIDE"
      ? storedProjectRoutes.map(({ credentialId }) => credentialId)
      : workspaceBinding?.enabled
        ? workspaceBinding.routes.map(({ credentialId }) => credentialId)
        : workspaceBinding
          ? []
          : storedProjectRoutes.map(({ credentialId }) => credentialId);
  const optionsById = new Map(
    projectConnectorOptions(settings, capability).map((option) => [
      option.id,
      option
    ])
  );
  return routeIds
    .map((credentialId) => optionsById.get(credentialId))
    .filter(
      (option): option is ProjectConnectorCredentialOption =>
        Boolean(
          option &&
            isProjectConnectorCredentialEligible(option, capability)
        )
    );
}

export function projectConnectorIncompatibleOptions(
  settings: ProjectConnectorSettings,
  capability: IntegrationCapability
): readonly ProjectConnectorCredentialOption[] {
  return settings.credentialOptions.filter(
    (credential) =>
      credentialModeSupportsCapability(credential.mode, capability) &&
      !credential.capabilities.includes(capability)
  );
}

export function isProjectConnectorCredentialEligible(
  credential: ProjectConnectorCredentialOption,
  capability: IntegrationCapability
): boolean {
  return (
    credentialModeSupportsCapability(credential.mode, capability) &&
    credential.status === "ACTIVE" &&
    credential.capabilities.includes(capability)
  );
}

function credentialModeSupportsCapability(
  mode: ProjectConnectorCredentialOption["mode"],
  capability: IntegrationCapability
): boolean {
  return (
    mode === "BYOK_API_KEY" ||
    (mode === "PLATFORM_PAID" && capability === "SERP_RANK_TRACKING")
  );
}

export function projectConnectorDraftDirty(
  binding: ProjectConnectorBinding | undefined,
  draft: ProjectConnectorDraft
): boolean {
  if (!binding) return draft.credentialId.length > 0;
  return (
    binding.enabled !== draft.enabled ||
    binding.route?.credentialId !== draft.credentialId
  );
}

export function canSubmitProjectConnectorDraft(
  binding: ProjectConnectorBinding | undefined,
  draft: ProjectConnectorDraft,
  options: readonly ProjectConnectorCredentialOption[],
  capability: IntegrationCapability
): boolean {
  if (
    binding &&
    !draft.enabled &&
    binding.route !== undefined &&
    draft.credentialId === binding.route.credentialId
  ) {
    return true;
  }
  const selected = options.find(({ id }) => id === draft.credentialId);
  return Boolean(
    selected && isProjectConnectorCredentialEligible(selected, capability)
  );
}

export function createProjectConnectorBindingInput(
  capability: IntegrationCapability,
  draft: ProjectConnectorDraft
): CreateProjectConnectorBindingInput {
  return {
    capability,
    enabled: draft.enabled,
    route: {
      position: 0,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: draft.credentialId
    },
    fallbackPolicy: { mode: "NONE" },
    budgetPolicy: { mode: "DISABLED" }
  };
}

export function updateProjectConnectorBindingInput(
  draft: ProjectConnectorDraft
): UpdateProjectConnectorBindingInput {
  return {
    enabled: draft.enabled,
    route: {
      position: 0,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: draft.credentialId
    },
    fallbackPolicy: { mode: "NONE" },
    budgetPolicy: { mode: "DISABLED" }
  };
}

export function projectConnectorCreatePayloadSignature(
  capability: IntegrationCapability,
  draft: ProjectConnectorDraft
): string {
  return JSON.stringify(
    createProjectConnectorBindingInput(capability, draft)
  );
}

export function stableProjectConnectorCreateCommand(
  current: IdempotentCreateCommand | undefined,
  payloadSignature: string,
  createKey: () => string
): IdempotentCreateCommand {
  return stableIdempotencyCommand(
    current,
    payloadSignature,
    createKey
  );
}
