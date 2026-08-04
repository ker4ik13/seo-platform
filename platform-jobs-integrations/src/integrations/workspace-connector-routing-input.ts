import { BadRequestException } from "@nestjs/common";
import {
  connectorFallbackReasons,
  integrationCapabilities,
  type ConnectorFallbackReason,
  type InternalUpsertWorkspaceConnectorBindingInput,
  type ProjectConnectorRouteInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAPABILITIES = new Set<string>(integrationCapabilities);
const REASONS = new Set<string>(connectorFallbackReasons);

export function internalUpsertWorkspaceConnectorBindingInput(
  value: unknown
): InternalUpsertWorkspaceConnectorBindingInput {
  const input = record(value, [
    "workspaceId",
    "capability",
    "actorId",
    "enabled",
    "routes",
    "fallbackPolicy",
    "version"
  ]);
  const capability = string(input.capability, "capability");
  if (!CAPABILITIES.has(capability)) invalid("capability");
  const routes = routeList(input.routes);
  const policy = record(input.fallbackPolicy, ["mode", "reasons"]);
  if (policy.mode !== "NONE" && policy.mode !== "NEXT_AVAILABLE") {
    invalid("fallbackPolicy.mode");
  }
  const reasons = policy.reasons === undefined
    ? policy.mode === "NONE" ? [] : [...connectorFallbackReasons]
    : stringList(policy.reasons, "fallbackPolicy.reasons");
  if (reasons.some((reason) => !REASONS.has(reason))) {
    invalid("fallbackPolicy.reasons");
  }
  if (
    (policy.mode === "NONE" && (routes.length !== 1 || reasons.length > 0)) ||
    (policy.mode === "NEXT_AVAILABLE" && routes.length < 2)
  ) {
    invalid("fallbackPolicy");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    capability: capability as InternalUpsertWorkspaceConnectorBindingInput["capability"],
    actorId: uuid(input.actorId, "actorId"),
    enabled: boolean(input.enabled, "enabled"),
    routes,
    fallbackPolicy: {
      mode: policy.mode,
      reasons: reasons as readonly ConnectorFallbackReason[]
    },
    ...(input.version === undefined
      ? {}
      : { version: positiveInteger(input.version, "version") })
  };
}

function routeList(value: unknown): readonly ProjectConnectorRouteInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    invalid("routes");
  }
  const routes = value.map((candidate, index) => {
    const route = record(candidate, ["position", "sourceKind", "credentialId"]);
    if (route.position !== index || route.sourceKind !== "WORKSPACE_CREDENTIAL") {
      invalid(`routes.${index}`);
    }
    return {
      position: index,
      sourceKind: "WORKSPACE_CREDENTIAL" as const,
      credentialId: uuid(route.credentialId, `routes.${index}.credentialId`)
    };
  });
  if (new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length) {
    invalid("routes.credentialId");
  }
  return routes;
}

function record(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
  return input;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(path);
  return value;
}

function uuid(value: unknown, path: string): string {
  const result = string(value, path);
  if (!UUID_PATTERN.test(result)) invalid(path);
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(path);
  return Number(value);
}

function stringList(value: unknown, path: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > connectorFallbackReasons.length ||
    value.some((item) => typeof item !== "string") ||
    new Set(value).size !== value.length
  ) invalid(path);
  return value as string[];
}

function invalid(path: string): never {
  throw new BadRequestException({
    code: "INVALID_WORKSPACE_CONNECTOR_ROUTING",
    message: "Workspace connector routing input is invalid",
    path
  });
}
