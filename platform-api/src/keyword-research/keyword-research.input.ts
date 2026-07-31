import { BadRequestException } from "@nestjs/common";
import {
  keysSoDatabases,
  semanticImportDuplicatePolicies,
  type ConfirmKeywordResearchRunInput,
  type CreateKeywordResearchRunInput,
  type KeysSoDatabase,
  type SemanticImportDuplicatePolicy
} from "@seo-platform/contracts";

const HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export function createKeywordResearchRunInput(
  value: unknown
): CreateKeywordResearchRunInput {
  const input = exact(value, ["domain", "database", "maxKeywords"]);
  return {
    domain: domain(input.domain),
    database: database(input.database),
    maxKeywords: integer(input.maxKeywords, "maxKeywords", 25, 500)
  };
}

export function confirmKeywordResearchRunInput(
  value: unknown
): ConfirmKeywordResearchRunInput {
  const input = exact(value, ["selectedRowIds", "duplicatePolicy"]);
  if (
    !Array.isArray(input.selectedRowIds) ||
    input.selectedRowIds.length < 1 ||
    input.selectedRowIds.length > 500
  ) {
    invalid("selectedRowIds");
  }
  const selectedRowIds = input.selectedRowIds.map((item, index) => {
    if (
      typeof item !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        item
      )
    ) {
      invalid(`selectedRowIds.${index}`);
    }
    return item.toLowerCase();
  });
  if (new Set(selectedRowIds).size !== selectedRowIds.length) {
    invalid("selectedRowIds");
  }
  if (
    typeof input.duplicatePolicy !== "string" ||
    !semanticImportDuplicatePolicies.includes(
      input.duplicatePolicy as SemanticImportDuplicatePolicy
    )
  ) {
    invalid("duplicatePolicy");
  }
  return {
    selectedRowIds,
    duplicatePolicy: input.duplicatePolicy as SemanticImportDuplicatePolicy
  };
}

export function assertEmptyKeywordResearchCancelInput(value: unknown): void {
  exact(value, []);
}

function domain(value: unknown): string {
  if (typeof value !== "string") invalid("domain");
  let normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  try {
    if (normalized.includes("://")) {
      const url = new URL(normalized);
      if (
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        invalid("domain");
      }
      normalized = url.hostname;
    }
  } catch {
    invalid("domain");
  }
  if (normalized.length > 253 || !HOST_PATTERN.test(normalized)) {
    invalid("domain");
  }
  return normalized;
}

function database(value: unknown): KeysSoDatabase {
  if (
    typeof value !== "string" ||
    !keysSoDatabases.includes(value as KeysSoDatabase)
  ) {
    invalid("database");
  }
  return value as KeysSoDatabase;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

function exact(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid("body");
  }
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid keyword research field: ${field}`);
}
