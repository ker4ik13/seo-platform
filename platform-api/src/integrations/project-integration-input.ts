import {
  integrationCapabilities,
  type CreateProjectConnectorBindingInput,
  type ProjectConnectorBudgetPolicy,
  type ProjectConnectorFallbackPolicy,
  type ProjectConnectorRouteInput,
  type UpdateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import { DomainError, validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

const CAPABILITIES = new Set<string>(integrationCapabilities);

export function createProjectConnectorBindingInput(
  value: unknown
): CreateProjectConnectorBindingInput {
  const input = strictRecord(value, [
    "capability",
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy"
  ]);
  if (
    typeof input.capability !== "string" ||
    !CAPABILITIES.has(input.capability)
  ) {
    invalid("capability");
  }
  return {
    capability:
      input.capability as CreateProjectConnectorBindingInput["capability"],
    enabled: booleanField(input, "enabled"),
    route: routeInput(input.route),
    fallbackPolicy: fallbackPolicy(input.fallbackPolicy),
    budgetPolicy: budgetPolicy(input.budgetPolicy)
  };
}

export function updateProjectConnectorBindingInput(
  value: unknown
): UpdateProjectConnectorBindingInput {
  const input = strictRecord(value, [
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy"
  ]);
  return {
    enabled: booleanField(input, "enabled"),
    route: routeInput(input.route),
    fallbackPolicy: fallbackPolicy(input.fallbackPolicy),
    budgetPolicy: budgetPolicy(input.budgetPolicy)
  };
}

function routeInput(value: unknown): ProjectConnectorRouteInput {
  const input = strictRecord(value, [
    "position",
    "sourceKind",
    "credentialId"
  ]);
  if (input.position !== 0) invalid("route.position");
  if (input.sourceKind !== "WORKSPACE_CREDENTIAL") {
    if (typeof input.sourceKind === "string") {
      unavailable("route.sourceKind");
    }
    invalid("route.sourceKind");
  }
  if (typeof input.credentialId !== "string") {
    invalid("route.credentialId");
  }
  return {
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: assertUuid(input.credentialId, "route.credentialId")
  };
}

function fallbackPolicy(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const input = strictRecord(value, ["mode"]);
  if (input.mode !== "NONE") {
    if (typeof input.mode === "string") {
      unavailable("fallbackPolicy.mode");
    }
    invalid("fallbackPolicy.mode");
  }
  return { mode: "NONE" };
}

function budgetPolicy(value: unknown): ProjectConnectorBudgetPolicy {
  const input = strictRecord(value, ["mode"]);
  if (input.mode !== "DISABLED") {
    if (typeof input.mode === "string") {
      unavailable("budgetPolicy.mode");
    }
    invalid("budgetPolicy.mode");
  }
  return { mode: "DISABLED" };
}

function booleanField(
  input: Readonly<Record<string, unknown>>,
  field: string
): boolean {
  const value = input[field];
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    invalid("body");
  }
  return input;
}

function invalid(path: string): never {
  throw validationError(
    path,
    "INVALID_PROJECT_INTEGRATION_SETTINGS",
    "Project integration settings are invalid"
  );
}

function unavailable(path: string): never {
  throw new DomainError({
    statusCode: 409,
    code: "FEATURE_NOT_AVAILABLE",
    message: "This integration source policy is not available yet",
    details: { path }
  });
}
