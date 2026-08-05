import {
  integrationProviders,
  type CreateIntegrationCredentialInput,
  type IntegrationProvider,
  type UpdateIntegrationCredentialInput
} from "@seo-platform/contracts";
import {
  inputObject,
  optionalStringField,
  stringField
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";

const PROVIDERS = new Set<string>(integrationProviders);
// oxlint-disable-next-line no-control-regex -- API key material explicitly excludes whitespace, C0 and DEL.
const API_KEY_PATTERN = /^[^\s\u0000-\u001f\u007f]{8,2048}$/u;
// oxlint-disable-next-line no-control-regex -- Provider identifiers explicitly exclude C0 and DEL.
const SAFE_IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]{1,255}$/u;

export function createIntegrationCredentialInput(
  value: unknown
): CreateIntegrationCredentialInput {
  const input = inputObject(value);
  const provider = providerField(input.provider);
  const apiKey = apiKeyField(input, true);
  const accountIdentifier = optionalAccountIdentifier(input);
  if (provider === "XMLSTOCK" && !accountIdentifier) {
    invalid("accountIdentifier");
  }
  return {
    provider,
    label: stringField(input, "label", { min: 1, max: 160 }).normalize(
      "NFC"
    ),
    apiKey,
    ...(accountIdentifier ? { accountIdentifier } : {})
  };
}

export function updateIntegrationCredentialInput(
  value: unknown
): UpdateIntegrationCredentialInput {
  const input = inputObject(value);
  const apiKey = apiKeyField(input, false);
  const accountIdentifier = optionalAccountIdentifier(input);
  if (accountIdentifier && !apiKey) invalid("apiKey");
  return {
    label: stringField(input, "label", { min: 1, max: 160 }).normalize(
      "NFC"
    ),
    ...(apiKey ? { apiKey } : {}),
    ...(accountIdentifier ? { accountIdentifier } : {})
  };
}

function apiKeyField(
  input: Readonly<Record<string, unknown>>,
  required: true
): string;
function apiKeyField(
  input: Readonly<Record<string, unknown>>,
  required: false
): string | undefined;
function apiKeyField(
  input: Readonly<Record<string, unknown>>,
  required: boolean
): string | undefined {
  const value = input.apiKey;
  if (
    !required &&
    (value === undefined || value === null || value === "")
  ) {
    return undefined;
  }
  if (typeof value !== "string" || !API_KEY_PATTERN.test(value)) {
    invalid("apiKey");
  }
  return value;
}

function optionalAccountIdentifier(
  input: Readonly<Record<string, unknown>>
): string | undefined {
  const value = optionalStringField(input, "accountIdentifier", {
    min: 1,
    max: 255
  });
  if (value && !SAFE_IDENTIFIER_PATTERN.test(value)) {
    invalid("accountIdentifier");
  }
  return value?.normalize("NFC");
}

function providerField(value: unknown): IntegrationProvider {
  if (typeof value !== "string" || !PROVIDERS.has(value)) {
    invalid("provider");
  }
  return value as IntegrationProvider;
}

function invalid(path: string): never {
  throw validationError(
    path,
    "INVALID_INTEGRATION_CREDENTIAL",
    "Enter a valid integration credential value"
  );
}
