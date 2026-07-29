import type {
  CreateProjectConnectorBindingInput,
  IntegrationCapability,
  ProjectConnectorBinding,
  ProjectConnectorBindingAvailability,
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  ProjectConnectorSettingsMutationRestriction,
  UpdateProjectConnectorBindingInput
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

export interface BindingAvailabilityPresentation {
  readonly label: string;
  readonly message: string;
  readonly tone: "active" | "danger" | "muted" | "pending" | "warning";
}

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
    credentialId: binding?.route.credentialId ?? "",
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
      credential.mode === "BYOK_API_KEY" &&
      credential.capabilities.includes(capability)
  );
}

export function projectConnectorIncompatibleOptions(
  settings: ProjectConnectorSettings,
  capability: IntegrationCapability
): readonly ProjectConnectorCredentialOption[] {
  return settings.credentialOptions.filter(
    (credential) =>
      credential.mode === "BYOK_API_KEY" &&
      !credential.capabilities.includes(capability)
  );
}

export function isProjectConnectorCredentialEligible(
  credential: ProjectConnectorCredentialOption,
  capability: IntegrationCapability
): boolean {
  return (
    credential.mode === "BYOK_API_KEY" &&
    credential.status === "ACTIVE" &&
    credential.capabilities.includes(capability)
  );
}

export function projectConnectorDraftDirty(
  binding: ProjectConnectorBinding | undefined,
  draft: ProjectConnectorDraft
): boolean {
  if (!binding) return draft.credentialId.length > 0;
  return (
    binding.enabled !== draft.enabled ||
    binding.route.credentialId !== draft.credentialId
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

export function projectConnectorRestrictionMessage(
  restriction: ProjectConnectorSettingsMutationRestriction
): string | undefined {
  const messages: Readonly<
    Record<
      ProjectConnectorSettingsMutationRestriction,
      string | undefined
    >
  > = {
    NONE: undefined,
    MISSING_PERMISSION:
      "Просмотр доступен, но для изменения источника требуется разрешение integration.update.",
    WORKSPACE_READ_ONLY:
      "Рабочая область доступна только для чтения. Текущая привязка сохранена, но изменения и новые операции заблокированы.",
    PROJECT_ARCHIVED:
      "Проект архивирован. Источники сохранены для просмотра, автоматические и новые операции остановлены."
  };
  return messages[restriction];
}

export function bindingAvailabilityPresentation(
  availability: ProjectConnectorBindingAvailability
): BindingAvailabilityPresentation {
  const presentations: Readonly<
    Record<
      ProjectConnectorBindingAvailability,
      BindingAvailabilityPresentation
    >
  > = {
    READY: {
      label: "Готово",
      message: "Активное подключение готово к использованию.",
      tone: "active"
    },
    DISABLED: {
      label: "Выключено",
      message: "Источник сохранён, но новые задания его не используют.",
      tone: "muted"
    },
    CREDENTIAL_PENDING: {
      label: "Ожидает проверки",
      message:
        "Выбранное подключение ещё не подтверждено провайдером и не может выполнять задания.",
      tone: "pending"
    },
    CREDENTIAL_UNAVAILABLE: {
      label: "Источник недоступен",
      message:
        "Выбранное подключение отозвано или недоступно. Выберите активное подключение либо выключите привязку.",
      tone: "danger"
    },
    CAPABILITY_MISMATCH: {
      label: "Функция недоступна",
      message:
        "Выбранное подключение больше не поддерживает эту функцию. Назначьте совместимый источник.",
      tone: "warning"
    }
  };
  return presentations[availability];
}
