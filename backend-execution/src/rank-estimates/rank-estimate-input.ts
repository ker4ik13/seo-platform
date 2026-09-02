import { BadRequestException } from "@nestjs/common";
import type {
  InternalCreateRankEstimateInput,
  RankEstimateQuota
} from "@seo-platform/contracts";

const INPUT_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "trackingContextId",
  "project",
  "access",
  "billingCurrency",
  "quota"
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
  "canRunRanking",
  "entitlementStatus"
] as const;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function internalCreateRankEstimateInput(
  value: unknown
): InternalCreateRankEstimateInput {
  const raw = record(value, "rankEstimate");
  const input = exactRecord(
    value,
    [
      ...INPUT_FIELDS,
      ...(Object.hasOwn(raw, "provider") ? ["provider"] : []),
      ...(Object.hasOwn(raw, "purpose") ? ["purpose"] : []),
      ...(Object.hasOwn(raw, "saveProjectPosition")
        ? ["saveProjectPosition"]
        : []),
      ...(Object.hasOwn(raw, "credentialId") ? ["credentialId"] : []),
      ...(Object.hasOwn(raw, "searchSource") ? ["searchSource"] : []),
      ...(Object.hasOwn(raw, "yandexLiveMode") ? ["yandexLiveMode"] : [])
    ],
    "rankEstimate"
  );
  const project = exactRecord(input.project, PROJECT_FIELDS, "project");
  const access = exactRecord(input.access, ACCESS_FIELDS, "access");
  const workspaceId = uuid(input.workspaceId, "workspaceId");
  const projectId = uuid(input.projectId, "projectId");
  const projectWorkspaceId = uuid(project.workspaceId, "project.workspaceId");
  const snapshotProjectId = uuid(project.id, "project.id");
  if (
    projectWorkspaceId !== workspaceId ||
    snapshotProjectId !== projectId
  ) {
    invalid("project.scope");
  }
  const domain = string(project.domain, "project.domain");
  if (!canonicalProjectDomain(domain)) invalid("project.domain");
  const projectStatus = string(project.status, "project.status");
  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(projectStatus)) {
    invalid("project.status");
  }
  const workspaceStatus = string(
    access.workspaceStatus,
    "access.workspaceStatus"
  );
  if (!["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(workspaceStatus)) {
    invalid("access.workspaceStatus");
  }
  const entitlementStatus = string(
    access.entitlementStatus,
    "access.entitlementStatus"
  );
  if (!["ALLOWED", "DENIED", "NOT_AVAILABLE"].includes(entitlementStatus)) {
    invalid("access.entitlementStatus");
  }
  if (typeof access.canRunRanking !== "boolean") {
    invalid("access.canRunRanking");
  }
  const billingCurrency = string(
    input.billingCurrency,
    "billingCurrency"
  );
  if (!/^[A-Z]{3}$/u.test(billingCurrency)) {
    invalid("billingCurrency");
  }
  const provider = input.provider === undefined
    ? undefined
    : rankProvider(input.provider, "provider");
  const purpose = input.purpose === undefined
    ? undefined
    : rankPurpose(input.purpose);
  const saveProjectPosition = input.saveProjectPosition === undefined
    ? undefined
    : boolean(input.saveProjectPosition, "saveProjectPosition");
  if (
    saveProjectPosition !== undefined &&
    purpose !== "COMPETITOR_SERP"
  ) {
    invalid("saveProjectPosition");
  }
  const searchSource = input.searchSource === undefined
    ? undefined
    : rankSearchSource(input.searchSource);
  const yandexLiveMode = input.yandexLiveMode === undefined
    ? undefined
    : rankYandexLiveMode(input.yandexLiveMode);
  if (
    yandexLiveMode === "TURBO" &&
    (provider !== "XMLSTOCK" || searchSource !== "LIVE")
  ) {
    invalid("yandexLiveMode");
  }
  return {
    workspaceId,
    projectId,
    actorId: uuid(input.actorId, "actorId"),
    trackingContextId: uuid(
      input.trackingContextId,
      "trackingContextId"
    ),
    ...(purpose === undefined ? {} : { purpose }),
    ...(saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition }),
    ...(provider === undefined ? {} : { provider }),
    ...(input.credentialId === undefined
      ? {}
      : { credentialId: uuid(input.credentialId, "credentialId") }),
    ...(searchSource === undefined ? {} : { searchSource }),
    ...(yandexLiveMode === undefined ? {} : { yandexLiveMode }),
    project: {
      id: snapshotProjectId,
      workspaceId: projectWorkspaceId,
      domain,
      status:
        projectStatus as InternalCreateRankEstimateInput["project"]["status"],
      version: positiveInteger(project.version, "project.version")
    },
    access: {
      workspaceStatus:
        workspaceStatus as InternalCreateRankEstimateInput["access"]["workspaceStatus"],
      canRunRanking: access.canRunRanking,
      entitlementStatus:
        entitlementStatus as InternalCreateRankEstimateInput["access"]["entitlementStatus"]
    },
    billingCurrency,
    quota: quota(input.quota)
  };
}

function rankPurpose(
  value: unknown
): "POSITION_TRACKING" | "COMPETITOR_SERP" {
  if (value !== "POSITION_TRACKING" && value !== "COMPETITOR_SERP") {
    invalid("purpose");
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function rankSearchSource(value: unknown): "SEARCH_API" | "LIVE" {
  if (value !== "SEARCH_API" && value !== "LIVE") {
    invalid("searchSource");
  }
  return value;
}

function rankYandexLiveMode(value: unknown): "TURBO" {
  if (value !== "TURBO") invalid("yandexLiveMode");
  return value;
}

function rankProvider(
  value: unknown,
  field: string
): "ARSENKIN" | "XMLSTOCK" {
  if (value !== "ARSENKIN" && value !== "XMLSTOCK") invalid(field);
  return value;
}

export function rankEstimateIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !IDEMPOTENCY_PATTERN.test(value)
  ) {
    invalid("Idempotency-Key");
  }
  return value;
}

function quota(value: unknown): RankEstimateQuota {
  const input = record(value, "quota");
  const status = string(input.status, "quota.status");
  if (status === "UNLIMITED" || status === "NOT_AVAILABLE") {
    exactFields(input, ["status"], "quota");
    return { status };
  }
  if (!["AVAILABLE", "EXHAUSTED"].includes(status)) {
    invalid("quota.status");
  }
  const fields = [
    "status",
    "limit",
    "used",
    "remaining",
    ...(input.resetsAt === undefined ? [] : ["resetsAt"])
  ];
  exactFields(input, fields, "quota");
  const limit = decimal(input.limit, "quota.limit");
  const used = decimal(input.used, "quota.used");
  const remaining = decimal(input.remaining, "quota.remaining");
  if (BigInt(used) + BigInt(remaining) !== BigInt(limit)) {
    invalid("quota.values");
  }
  if (
    (status === "EXHAUSTED" && remaining !== "0") ||
    (status === "AVAILABLE" && BigInt(remaining) < 1n)
  ) {
    invalid("quota.status");
  }
  const resetsAt =
    input.resetsAt === undefined
      ? undefined
      : timestamp(input.resetsAt, "quota.resetsAt");
  return {
    status: status as "AVAILABLE" | "EXHAUSTED",
    limit,
    used,
    remaining,
    ...(resetsAt ? { resetsAt } : {})
  };
}

function exactRecord<const Fields extends readonly string[]>(
  value: unknown,
  fields: Fields,
  path: string
): Readonly<Record<Fields[number], unknown>> {
  const input = record(value, path);
  exactFields(input, fields, path);
  return input as Readonly<Record<Fields[number], unknown>>;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: string
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid(`${path}.fields`);
  }
}

function record(
  value: unknown,
  path: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path);
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, field: string): string {
  const id = string(value, field);
  if (!UUID_PATTERN.test(id)) invalid(field);
  return id.toLowerCase();
}

function string(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim()
  ) {
    invalid(field);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function decimal(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^(?:0|[1-9]\d{0,19})$/u.test(result)) invalid(field);
  return result;
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field);
  const parsed = new Date(result);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== result
  ) {
    invalid(field);
  }
  return result;
}

function canonicalProjectDomain(value: string): boolean {
  if (
    value.length > 255 ||
    value !== value.toLowerCase() ||
    !value.includes(".")
  ) {
    return false;
  }
  try {
    const parsed = new URL(`https://${value}`);
    return (
      parsed.hostname === value &&
      parsed.port === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}
