import { BadRequestException } from "@nestjs/common";
import {
  connectorFallbackReasons,
  type ConnectorFallbackReason,
  type UpsertWorkspaceConnectorBindingInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FALLBACK_REASONS = new Set<string>(connectorFallbackReasons);

export function upsertWorkspaceConnectorBindingInput(
  value: unknown
): UpsertWorkspaceConnectorBindingInput {
  const input = record(value, [
    "enabled",
    "routes",
    "fallbackPolicy",
    "version"
  ]);
  if (typeof input.enabled !== "boolean") invalid("enabled");
  if (!Array.isArray(input.routes) || input.routes.length < 1 || input.routes.length > 8) {
    invalid("routes");
  }
  const routes = input.routes.map((candidate, index) => {
    const route = record(candidate, ["position", "sourceKind", "credentialId"]);
    if (
      route.position !== index ||
      route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
      typeof route.credentialId !== "string" ||
      !UUID_PATTERN.test(route.credentialId)
    ) {
      invalid(`routes.${index}`);
    }
    return {
      position: index,
      sourceKind: "WORKSPACE_CREDENTIAL" as const,
      credentialId: route.credentialId
    };
  });
  if (new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length) {
    invalid("routes.credentialId");
  }
  const policy = record(input.fallbackPolicy, ["mode", "reasons"]);
  if (policy.mode !== "NONE" && policy.mode !== "NEXT_AVAILABLE") {
    invalid("fallbackPolicy.mode");
  }
  const reasons = policy.reasons === undefined
    ? policy.mode === "NONE" ? [] : [...connectorFallbackReasons]
    : reasonList(policy.reasons);
  if (
    (policy.mode === "NONE" && (routes.length !== 1 || reasons.length > 0)) ||
    (policy.mode === "NEXT_AVAILABLE" && routes.length < 2)
  ) {
    invalid("fallbackPolicy");
  }
  const version = input.version;
  if (version !== undefined && (!Number.isSafeInteger(version) || Number(version) < 1)) {
    invalid("version");
  }
  return {
    enabled: input.enabled,
    routes,
    fallbackPolicy: {
      mode: policy.mode,
      reasons
    },
    ...(version === undefined ? {} : { version: Number(version) })
  };
}

function reasonList(value: unknown): readonly ConnectorFallbackReason[] {
  if (
    !Array.isArray(value) ||
    value.length > connectorFallbackReasons.length ||
    value.some((reason) => typeof reason !== "string" || !FALLBACK_REASONS.has(reason)) ||
    new Set(value).size !== value.length
  ) {
    invalid("fallbackPolicy.reasons");
  }
  return value as readonly ConnectorFallbackReason[];
}

function record(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((field) => !fields.includes(field))) {
    invalid("body");
  }
  return input;
}

function invalid(path: string): never {
  throw new BadRequestException({
    code: "INVALID_WORKSPACE_CONNECTOR_ROUTING",
    message: "Workspace connector routing input is invalid",
    path
  });
}
