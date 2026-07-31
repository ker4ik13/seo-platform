import type {
  CreateSemanticClusterInput,
  UpdateSemanticClusterInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

export function createSemanticClusterInput(
  value: unknown
): CreateSemanticClusterInput {
  return { name: clusterName(exactRecord(value).name) };
}

export function updateSemanticClusterInput(
  value: unknown
): UpdateSemanticClusterInput {
  return { name: clusterName(exactRecord(value).name) };
}

function exactRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => key !== "name")) {
    invalid("$", "Contains unsupported fields");
  }
  return input;
}

function clusterName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255) {
    invalid("name", "Must contain 1 to 255 characters");
  }
  return name;
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_CLUSTER", message);
}
