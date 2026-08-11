import type {
  AdminOperationStatusGroup,
  AdminProjectStatus
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { adminWorkspaceSearchQuery } from "./platform-admin-workspace-input.js";

const PROJECT_STATUSES = new Set<AdminProjectStatus>([
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
  "DELETING",
  "DELETED"
]);
const OPERATION_STATUS_GROUPS = new Set<AdminOperationStatusGroup>([
  "ALL",
  "ACTIVE",
  "COMPLETED",
  "ATTENTION"
]);
const OPERATION_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PAGE_LIMITS = new Set([20, 50, 100]);

export interface AdminProjectQuery {
  readonly search: string;
  readonly status?: AdminProjectStatus;
}

export interface AdminOperationQuery {
  readonly statusGroup: AdminOperationStatusGroup;
  readonly type?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export function adminProjectQuery(input: {
  readonly q?: unknown;
  readonly status?: unknown;
}): AdminProjectQuery {
  const search = adminWorkspaceSearchQuery(input.q);
  const status = optionalString(input.status)?.toUpperCase();
  if (status && status !== "ALL" && !PROJECT_STATUSES.has(status as AdminProjectStatus)) {
    throw invalid("status");
  }
  return {
    search,
    ...(status && status !== "ALL"
      ? { status: status as AdminProjectStatus }
      : {})
  };
}

export function adminOperationQuery(input: {
  readonly status?: unknown;
  readonly type?: unknown;
  readonly cursor?: unknown;
  readonly limit?: unknown;
}): AdminOperationQuery {
  const status = optionalString(input.status)?.toUpperCase() ?? "ALL";
  if (!OPERATION_STATUS_GROUPS.has(status as AdminOperationStatusGroup)) {
    throw invalid("status");
  }
  const type = optionalString(input.type)?.toUpperCase();
  if (type && !OPERATION_TYPE_PATTERN.test(type)) throw invalid("type");
  const cursor = optionalString(input.cursor)?.toLowerCase();
  if (cursor && !UUID_PATTERN.test(cursor)) throw invalid("cursor");
  const limitValue = optionalString(input.limit);
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || !PAGE_LIMITS.has(limit)) {
    throw invalid("limit");
  }
  return {
    statusGroup: status as AdminOperationStatusGroup,
    limit,
    ...(type ? { type } : {}),
    ...(cursor ? { cursor } : {})
  };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalid("query");
  const normalized = value.trim();
  return normalized || undefined;
}

function invalid(field: string) {
  return validationError(
    field,
    "INVALID_ADMIN_QUERY",
    "Invalid platform administration query"
  );
}
