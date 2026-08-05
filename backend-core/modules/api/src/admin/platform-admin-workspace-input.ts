import type {
  GrantAdminWorkspaceSubscriptionInput
} from "@seo-platform/contracts";
import { DomainError, validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import {
  booleanField,
  inputObject,
  stringField
} from "../common/input.js";
import { requiredVersion } from "../common/version-precondition.js";

const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/u;
const MAXIMUM_GRANT_YEARS = 5;
const SUBSCRIPTION_GRANT_FIELDS = new Set([
  "planCode",
  "planVersion",
  "currentPeriodEnd",
  "confirmWorkspaceId",
  "confirmed",
  "reason"
]);

export interface AdminSubscriptionPrecondition {
  readonly createOnly: boolean;
  readonly expectedVersion?: number;
}

export function adminWorkspaceSearchQuery(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw validationError("q", "STRING_REQUIRED", "Search must be a string");
  }
  const query = value.trim();
  if (query.length > 160 || hasControlCharacter(query)) {
    throw validationError(
      "q",
      "INVALID_SEARCH_QUERY",
      "Search must contain at most 160 printable characters"
    );
  }
  return query;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function grantAdminWorkspaceSubscriptionInput(
  value: unknown,
  workspaceId: string,
  now = new Date()
): GrantAdminWorkspaceSubscriptionInput {
  const input = inputObject(value);
  if (
    Object.keys(input).some(
      (field) => !SUBSCRIPTION_GRANT_FIELDS.has(field)
    )
  ) {
    throw validationError(
      "$",
      "UNKNOWN_FIELD",
      "Body fields do not match the subscription grant contract"
    );
  }
  const planCode = stringField(input, "planCode", { min: 2, max: 32 });
  if (!PLAN_CODE_PATTERN.test(planCode)) {
    throw validationError("planCode", "INVALID_PLAN", "Unknown plan code");
  }
  const planVersion = positiveInteger(input.planVersion, "planVersion");
  const currentPeriodEnd = boundedFutureDate(
    stringField(input, "currentPeriodEnd", { min: 20, max: 40 }),
    now
  );
  const confirmWorkspaceId = assertUuid(
    stringField(input, "confirmWorkspaceId", { min: 36, max: 36 }),
    "confirmWorkspaceId"
  );
  if (confirmWorkspaceId !== workspaceId) {
    throw validationError(
      "confirmWorkspaceId",
      "CONFIRMATION_MISMATCH",
      "Confirm the exact target workspace"
    );
  }
  if (!booleanField(input, "confirmed")) {
    throw validationError(
      "confirmed",
      "CONFIRMATION_REQUIRED",
      "Explicit confirmation is required"
    );
  }
  return {
    planCode,
    planVersion,
    currentPeriodEnd,
    confirmWorkspaceId,
    confirmed: true,
    reason: stringField(input, "reason", { min: 8, max: 500 })
  };
}

export function adminSubscriptionPrecondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined
): AdminSubscriptionPrecondition {
  if (ifMatch && ifNoneMatch) {
    throw validationError(
      "If-Match",
      "CONFLICTING_PRECONDITIONS",
      "Use either If-Match or If-None-Match"
    );
  }
  if (ifMatch) {
    return { createOnly: false, expectedVersion: requiredVersion(ifMatch) };
  }
  if (ifNoneMatch === "*") return { createOnly: true };
  if (ifNoneMatch) {
    throw validationError(
      "If-None-Match",
      "INVALID_VERSION",
      "Use If-None-Match: * when creating a subscription"
    );
  }
  throw new DomainError({
    statusCode: 428,
    code: "VERSION_CONFLICT",
    message: "If-Match or If-None-Match header is required"
  });
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw validationError(
      field,
      "POSITIVE_INTEGER_REQUIRED",
      "A positive integer is required"
    );
  }
  return Number(value);
}

function boundedFutureDate(value: string, now: Date): string {
  const date = new Date(value);
  const maximum = new Date(now);
  maximum.setUTCFullYear(maximum.getUTCFullYear() + MAXIMUM_GRANT_YEARS);
  if (
    Number.isNaN(date.getTime()) ||
    date <= now ||
    date > maximum
  ) {
    throw validationError(
      "currentPeriodEnd",
      "INVALID_DATE",
      `Use a future timestamp no more than ${MAXIMUM_GRANT_YEARS} years away`
    );
  }
  return date.toISOString();
}
