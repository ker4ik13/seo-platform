import { BadRequestException } from "@nestjs/common";
import {
  integrationProviders,
  type CreateIntegrationCredentialInput,
  type IntegrationProvider,
  type InternalCreateIntegrationCredentialInput,
  type InternalCreateIntegrationCredentialValidationInput,
  type InternalDeleteIntegrationCredentialInput,
  type InternalUpdateIntegrationCredentialInput,
  type UpdateIntegrationCredentialInput
} from "@seo-platform/contracts";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SECRET_PATTERN = /^[^\s\u0000-\u001f\u007f]{8,2048}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]{1,255}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const PROVIDERS = new Set<string>(integrationProviders);

export function createIntegrationCredentialInput(
  value: unknown
): CreateIntegrationCredentialInput {
  const input = record(value);
  const provider = providerField(input);
  const accountIdentifier = optionalAccountIdentifier(input);
  requireProviderFields(provider, accountIdentifier);
  return {
    provider,
    label: labelField(input),
    apiKey: apiKeyField(input),
    ...(accountIdentifier ? { accountIdentifier } : {})
  };
}

export function internalCreateIntegrationCredentialInput(
  value: unknown
): InternalCreateIntegrationCredentialInput {
  const input = record(value);
  const idempotencyKey = stringField(input, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  return {
    ...createIntegrationCredentialInput(input),
    workspaceId: uuidField(input, "workspaceId"),
    actorId: uuidField(input, "actorId"),
    idempotencyKey
  };
}

export function internalCreateIntegrationCredentialValidationInput(
  value: unknown
): InternalCreateIntegrationCredentialValidationInput {
  const input = record(value);
  const idempotencyKey = stringField(input, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  return {
    workspaceId: uuidField(input, "workspaceId"),
    actorId: uuidField(input, "actorId"),
    idempotencyKey
  };
}

export function updateIntegrationCredentialInput(
  value: unknown
): UpdateIntegrationCredentialInput {
  const input = record(value);
  const apiKey =
    input.apiKey === undefined ? undefined : apiKeyField(input);
  const accountIdentifier = optionalAccountIdentifier(input);
  if (accountIdentifier && !apiKey) invalid("apiKey");
  return {
    label: labelField(input),
    ...(apiKey ? { apiKey } : {}),
    ...(accountIdentifier ? { accountIdentifier } : {})
  };
}

export function internalUpdateIntegrationCredentialInput(
  value: unknown
): InternalUpdateIntegrationCredentialInput {
  const input = record(value);
  return {
    ...updateIntegrationCredentialInput(input),
    workspaceId: uuidField(input, "workspaceId"),
    actorId: uuidField(input, "actorId"),
    version: versionField(input)
  };
}

export function internalDeleteIntegrationCredentialInput(
  value: unknown
): InternalDeleteIntegrationCredentialInput {
  const input = record(value);
  return {
    workspaceId: uuidField(input, "workspaceId"),
    actorId: uuidField(input, "actorId"),
    version: versionField(input)
  };
}

function requireProviderFields(
  provider: IntegrationProvider,
  accountIdentifier: string | undefined
): void {
  if (
    integrationProviderMetadata(provider).requiresAccountIdentifier &&
    !accountIdentifier
  ) {
    invalid("accountIdentifier");
  }
}

function providerField(
  input: Readonly<Record<string, unknown>>
): IntegrationProvider {
  const provider = stringField(input, "provider");
  if (!PROVIDERS.has(provider)) invalid("provider");
  return provider as IntegrationProvider;
}

function labelField(input: Readonly<Record<string, unknown>>): string {
  const label = stringField(input, "label").normalize("NFC");
  if (label.length > 160) invalid("label");
  return label;
}

function apiKeyField(input: Readonly<Record<string, unknown>>): string {
  const apiKey = input.apiKey;
  if (typeof apiKey !== "string") invalid("apiKey");
  if (!SECRET_PATTERN.test(apiKey)) invalid("apiKey");
  return apiKey;
}

function optionalAccountIdentifier(
  input: Readonly<Record<string, unknown>>
): string | undefined {
  if (
    input.accountIdentifier === undefined ||
    input.accountIdentifier === null ||
    input.accountIdentifier === ""
  ) {
    return undefined;
  }
  const identifier = stringField(input, "accountIdentifier").normalize("NFC");
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    invalid("accountIdentifier");
  }
  return identifier;
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

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringField(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}
