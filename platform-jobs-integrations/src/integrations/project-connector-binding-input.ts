import {
  BadRequestException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  integrationCapabilities,
  type InternalCreateProjectConnectorBindingInput,
  type InternalUpdateProjectConnectorBindingInput,
  type ProjectConnectorBudgetPolicy,
  type ProjectConnectorFallbackPolicy,
  type ProjectConnectorRouteInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const CAPABILITIES = new Set<string>(integrationCapabilities);

const CREATE_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "idempotencyKey",
  "capability",
  "enabled",
  "route",
  "fallbackPolicy",
  "budgetPolicy"
] as const;

const UPDATE_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "version",
  "enabled",
  "route",
  "fallbackPolicy",
  "budgetPolicy"
] as const;

export function internalCreateProjectConnectorBindingInput(
  value: unknown
): InternalCreateProjectConnectorBindingInput {
  const input = exactRecord(value, CREATE_FIELDS, "binding");
  const idempotencyKey = stringField(input, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  const capability = stringField(input, "capability");
  if (!CAPABILITIES.has(capability)) invalid("capability");
  return {
    workspaceId: uuidField(input, "workspaceId"),
    projectId: uuidField(input, "projectId"),
    actorId: uuidField(input, "actorId"),
    idempotencyKey,
    capability:
      capability as InternalCreateProjectConnectorBindingInput["capability"],
    enabled: booleanField(input, "enabled"),
    route: routeField(input.route),
    fallbackPolicy: fallbackPolicyField(input.fallbackPolicy),
    budgetPolicy: budgetPolicyField(input.budgetPolicy)
  };
}

export function internalUpdateProjectConnectorBindingInput(
  value: unknown
): InternalUpdateProjectConnectorBindingInput {
  const input = exactRecord(value, UPDATE_FIELDS, "binding");
  return {
    workspaceId: uuidField(input, "workspaceId"),
    projectId: uuidField(input, "projectId"),
    actorId: uuidField(input, "actorId"),
    version: versionField(input),
    enabled: booleanField(input, "enabled"),
    route: routeField(input.route),
    fallbackPolicy: fallbackPolicyField(input.fallbackPolicy),
    budgetPolicy: budgetPolicyField(input.budgetPolicy)
  };
}

function routeField(value: unknown): ProjectConnectorRouteInput {
  const route = exactRecord(
    value,
    ["position", "sourceKind", "credentialId"] as const,
    "route"
  );
  if (route.position !== 0) featureNotAvailable("fallback routes");
  if (route.sourceKind !== "WORKSPACE_CREDENTIAL") {
    featureNotAvailable("platform credentials");
  }
  return {
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: uuidField(route, "credentialId")
  };
}

function fallbackPolicyField(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const policy = exactRecord(value, ["mode"] as const, "fallbackPolicy");
  if (policy.mode !== "NONE") {
    featureNotAvailable("connector fallback");
  }
  return { mode: "NONE" };
}

function budgetPolicyField(value: unknown): ProjectConnectorBudgetPolicy {
  const policy = exactRecord(value, ["mode"] as const, "budgetPolicy");
  if (policy.mode !== "DISABLED") {
    featureNotAvailable("connector binding budgets");
  }
  return { mode: "DISABLED" };
}

function versionField(input: Readonly<Record<string, unknown>>): number {
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    invalid("version");
  }
  return Number(input.version);
}

function uuidField(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = stringField(input, field);
  if (!UUID_PATTERN.test(value)) invalid(field);
  return value.toLowerCase();
}

function booleanField(
  input: Readonly<Record<string, unknown>>,
  field: string
): boolean {
  if (typeof input[field] !== "boolean") invalid(field);
  return input[field] as boolean;
}

function stringField(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = input[field];
  if (typeof value !== "string" || value !== value.trim() || !value) {
    invalid(field);
  }
  return value;
}

function exactRecord<const Fields extends readonly string[]>(
  value: unknown,
  fields: Fields,
  path: string
): Readonly<Record<Fields[number], unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path);
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set<string>(fields);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    invalid(`${path}.unknownField`);
  }
  if (fields.some((field) => !(field in input))) {
    invalid(`${path}.missingField`);
  }
  return input as Readonly<Record<Fields[number], unknown>>;
}

function featureNotAvailable(feature: string): never {
  throw new UnprocessableEntityException({
    code: "FEATURE_NOT_AVAILABLE",
    message: `${feature} is not available in this release`
  });
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}
