import { BadRequestException } from "@nestjs/common";
import type {
  InternalCancelRankJobInput,
  InternalCreateRankRunInput,
  InternalRankJobQuery,
  InternalRetryRankJobInput,
  RankEstimateQuota
} from "@seo-platform/contracts";

const CREATE_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "estimateId",
  "project",
  "access",
  "billingCurrency",
  "jobCapacity"
] as const;
const PROJECT_FIELDS = [
  "id",
  "workspaceId",
  "domain",
  "status",
  "version"
] as const;
const ACCESS_FIELDS = [
  "workspaceStatus",
  "membershipId",
  "membershipVersion",
  "canRunRanking",
  "entitlementStatus",
  "quota"
] as const;
const QUERY_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "jobId"
] as const;

export function internalCreateRankRunInput(
  value: unknown
): InternalCreateRankRunInput {
  const input = exactRecord(value, CREATE_FIELDS, "rankRun");
  const project = exactRecord(input.project, PROJECT_FIELDS, "project");
  const access = exactRecord(input.access, ACCESS_FIELDS, "access");
  const jobCapacity = exactRecord(
    input.jobCapacity,
    ["planCode", "planVersion", "concurrentJobs"],
    "jobCapacity"
  );
  const workspaceId = uuid(input.workspaceId, "workspaceId");
  const projectId = uuid(input.projectId, "projectId");
  const actorId = uuid(input.actorId, "actorId");
  const estimateId = uuid(input.estimateId, "estimateId");
  if (
    uuid(project.id, "project.id") !== projectId ||
    uuid(project.workspaceId, "project.workspaceId") !== workspaceId ||
    typeof project.domain !== "string" ||
    project.domain.length < 1 ||
    project.domain.length > 2_048 ||
    project.domain !== project.domain.trim() ||
    !["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(project.status)) ||
    !positiveInteger(project.version) ||
    !["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(
      String(access.workspaceStatus)
    ) ||
    typeof access.canRunRanking !== "boolean" ||
    !["ALLOWED", "DENIED", "NOT_AVAILABLE"].includes(
      String(access.entitlementStatus)
    ) ||
    !positiveInteger(access.membershipVersion) ||
    typeof input.billingCurrency !== "string" ||
    !/^[A-Z]{3}$/u.test(input.billingCurrency) ||
    typeof jobCapacity.planCode !== "string" ||
    jobCapacity.planCode.length < 1 ||
    jobCapacity.planCode.length > 64 ||
    !positiveInteger(jobCapacity.planVersion) ||
    !positiveInteger(jobCapacity.concurrentJobs)
  ) {
    invalid("rankRun");
  }
  return {
    workspaceId,
    projectId,
    actorId,
    estimateId,
    project: {
      id: projectId,
      workspaceId,
      domain: project.domain,
      status:
        project.status as InternalCreateRankRunInput["project"]["status"],
      version: Number(project.version)
    },
    access: {
      workspaceStatus:
        access.workspaceStatus as InternalCreateRankRunInput["access"]["workspaceStatus"],
      membershipId: uuid(access.membershipId, "access.membershipId"),
      membershipVersion: Number(access.membershipVersion),
      canRunRanking: access.canRunRanking,
      entitlementStatus:
        access.entitlementStatus as InternalCreateRankRunInput["access"]["entitlementStatus"],
      quota: quota(access.quota)
    },
    billingCurrency: input.billingCurrency,
    jobCapacity: {
      planCode: jobCapacity.planCode,
      planVersion: Number(jobCapacity.planVersion),
      concurrentJobs: Number(jobCapacity.concurrentJobs)
    }
  };
}

export function internalRankJobQuery(
  value: unknown
): InternalRankJobQuery {
  const input = exactRecord(value, QUERY_FIELDS, "rankJob");
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    jobId: uuid(input.jobId, "jobId")
  };
}

export function internalCancelRankJobInput(
  value: unknown
): InternalCancelRankJobInput {
  return internalRankJobQuery(value);
}

export function internalRetryRankJobInput(
  value: unknown
): InternalRetryRankJobInput {
  const raw = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "project",
    "access",
    "billingCurrency",
    "jobCapacity"
  ], "rankRetry");
  const { jobId, ...createFields } = raw;
  const created = internalCreateRankRunInput({
    ...createFields,
    estimateId: "00000000-0000-7000-8000-000000000000"
  });
  return {
    workspaceId: created.workspaceId,
    projectId: created.projectId,
    actorId: created.actorId,
    jobId: uuid(jobId, "jobId"),
    project: created.project,
    access: created.access,
    billingCurrency: created.billingCurrency,
    jobCapacity: created.jobCapacity
  };
}

export function rankRunIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 180 ||
    value !== value.trim() ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    invalid("Idempotency-Key");
  }
  return value;
}

function quota(value: unknown): RankEstimateQuota {
  const input = record(value, "access.quota");
  if (input.status === "NOT_AVAILABLE") {
    exactFields(input, ["status"], "access.quota");
    return { status: "NOT_AVAILABLE" };
  }
  if (input.status !== "AVAILABLE" && input.status !== "EXHAUSTED") {
    invalid("access.quota");
  }
  const fields = [
    "status",
    "limit",
    "used",
    "remaining",
    ...(input.resetsAt === undefined ? [] : ["resetsAt"])
  ];
  exactFields(input, fields, "access.quota");
  const limit = decimal(input.limit, "access.quota.limit");
  const used = decimal(input.used, "access.quota.used");
  const remaining = decimal(input.remaining, "access.quota.remaining");
  if (
    BigInt(used) > BigInt(limit) ||
    BigInt(remaining) > BigInt(limit) ||
    BigInt(used) + BigInt(remaining) !== BigInt(limit) ||
    (input.status === "EXHAUSTED" && remaining !== "0") ||
    (input.status === "AVAILABLE" && BigInt(remaining) < 1n)
  ) {
    invalid("access.quota");
  }
  const resetsAt =
    input.resetsAt === undefined
      ? undefined
      : timestamp(input.resetsAt, "access.quota.resetsAt");
  return {
    status: input.status,
    limit,
    used,
    remaining,
    ...(resetsAt ? { resetsAt } : {})
  };
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  name: string
): Readonly<Record<string, unknown>> {
  const input = record(value, name);
  exactFields(input, fields, name);
  return input;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  name: string
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid(name);
  }
}

function record(
  value: unknown,
  name: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(name);
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  ) {
    invalid(name);
  }
  return value;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function decimal(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    invalid(name);
  }
  return value;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string") invalid(name);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(name);
  }
  return value;
}

function invalid(name: string): never {
  throw new BadRequestException(`Invalid ${name}`);
}
