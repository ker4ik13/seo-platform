import { BadRequestException } from "@nestjs/common";
import type { AdminOperationStatusGroup } from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/u;
const STATUS_GROUPS = new Set<AdminOperationStatusGroup>([
  "ALL",
  "ACTIVE",
  "COMPLETED",
  "ATTENTION"
]);
const PAGE_LIMITS = new Set([20, 50, 100]);

export interface PlatformAdminOperationQuery {
  readonly statusGroup: AdminOperationStatusGroup;
  readonly type?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export function platformAdminOperationQuery(input: {
  readonly status?: unknown;
  readonly type?: unknown;
  readonly cursor?: unknown;
  readonly limit?: unknown;
}): PlatformAdminOperationQuery {
  const status = optionalString(input.status)?.toUpperCase() ?? "ALL";
  if (!STATUS_GROUPS.has(status as AdminOperationStatusGroup)) throw invalid();
  const type = optionalString(input.type)?.toUpperCase();
  if (type && !TYPE_PATTERN.test(type)) throw invalid();
  const cursor = optionalString(input.cursor)?.toLowerCase();
  if (cursor && !UUID_PATTERN.test(cursor)) throw invalid();
  const limitValue = optionalString(input.limit);
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || !PAGE_LIMITS.has(limit)) throw invalid();
  return {
    statusGroup: status as AdminOperationStatusGroup,
    limit,
    ...(type ? { type } : {}),
    ...(cursor ? { cursor } : {})
  };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalid();
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized;
}

function invalid(): BadRequestException {
  return new BadRequestException("Invalid platform admin operation query");
}
