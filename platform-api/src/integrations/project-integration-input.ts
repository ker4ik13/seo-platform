import {
  connectorFallbackModes,
  connectorFallbackReasons,
  integrationCapabilities,
  type ConnectorFallbackReason,
  type CreateProjectConnectorBindingInput,
  type ProjectConnectorBudgetPolicy,
  type ProjectConnectorFallbackPolicy,
  type ProjectConnectorRouteInput,
  type UpdateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

const CAPABILITIES = new Set<string>(integrationCapabilities);
const FALLBACK_MODES = new Set<string>(connectorFallbackModes);
const FALLBACK_REASONS = new Set<string>(connectorFallbackReasons);

export function createProjectConnectorBindingInput(
  value: unknown
): CreateProjectConnectorBindingInput {
  const input = strictRecord(value, [
    "capability",
    "enabled",
    "route",
    "fallbackRoutes",
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
    route: routeInput(input.route, 0),
    fallbackRoutes: fallbackRoutes(input.fallbackRoutes),
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
    "fallbackRoutes",
    "fallbackPolicy",
    "budgetPolicy"
  ]);
  return {
    enabled: booleanField(input, "enabled"),
    route: routeInput(input.route, 0),
    fallbackRoutes: fallbackRoutes(input.fallbackRoutes),
    fallbackPolicy: fallbackPolicy(input.fallbackPolicy),
    budgetPolicy: budgetPolicy(input.budgetPolicy)
  };
}

function routeInput(
  value: unknown,
  expectedPosition: number
): ProjectConnectorRouteInput {
  const input = strictRecord(value, [
    "position",
    "sourceKind",
    "credentialId"
  ]);
  if (input.position !== expectedPosition) invalid("route.position");
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
    position: expectedPosition,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: assertUuid(input.credentialId, "route.credentialId")
  };
}

function fallbackRoutes(value: unknown): readonly ProjectConnectorRouteInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 7) {
    invalid("fallbackRoutes");
  }
  const routes = value.map((route, index) => routeInput(route, index + 1));
  if (new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length) {
    invalid("fallbackRoutes.credentialId");
  }
  return routes;
}

function fallbackPolicy(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const input = strictRecord(value, ["mode", "reasons"]);
  if (typeof input.mode !== "string" || !FALLBACK_MODES.has(input.mode)) {
    invalid("fallbackPolicy.mode");
  }
  const reasons = input.reasons === undefined
    ? input.mode === "NONE" ? [] : [...connectorFallbackReasons]
    : stringList(input.reasons, "fallbackPolicy.reasons");
  if (reasons.some((reason) => !FALLBACK_REASONS.has(reason))) {
    invalid("fallbackPolicy.reasons");
  }
  if (input.mode === "NONE" && reasons.length > 0) {
    invalid("fallbackPolicy.reasons");
  }
  return {
    mode: input.mode as ProjectConnectorFallbackPolicy["mode"],
    reasons: reasons as readonly ConnectorFallbackReason[]
  };
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > connectorFallbackReasons.length) {
    invalid(path);
  }
  if (value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    invalid(path);
  }
  return value as string[];
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

function unavailable(path: string): never {
  throw validationError(
    path,
    "FEATURE_NOT_AVAILABLE",
    `${path} is not available in this release`
  );
}

function invalid(path: string): never {
  throw validationError(
    path,
    "INVALID_PROJECT_INTEGRATION_SETTINGS",
    "Project integration settings are invalid"
  );
}
