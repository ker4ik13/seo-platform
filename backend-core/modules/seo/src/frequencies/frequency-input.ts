import { BadRequestException } from "@nestjs/common";
import {
  frequencyCollectionProviders,
  internalFrequencyPersistBatchLimit,
  internalFrequencyResolveBatchLimit,
  semanticFrequencyTypes,
  semanticFrequencyDevices,
  semanticFrequencyQualityFlags,
  type InternalPersistFrequencySnapshotBatchInput,
  type InternalPersistFrequencySnapshotsInput,
  type InternalResolveFrequencyKeywordsInput,
  type InternalResolveFrequencyKeywordInput,
  type InternalFrequencySnapshotValue,
  type SemanticFrequencyType
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REGION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,18})$/u;

export function internalResolveFrequencyKeywordInput(
  value: unknown
): InternalResolveFrequencyKeywordInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "keywordId",
    "version"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    keywordId: uuid(input.keywordId, "keywordId"),
    version: integer(input.version, "version")
  };
}

export function internalResolveFrequencyKeywordsInput(
  value: unknown
): InternalResolveFrequencyKeywordsInput {
  const input = record(value, ["workspaceId", "projectId", "actorId", "items"]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalFrequencyResolveBatchLimit
  ) {
    invalid("items");
  }
  const items = input.items.map((value, index) => {
    const item = record(value, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`)
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    invalid("items");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    items
  };
}

export function internalPersistFrequencySnapshotsInput(
  value: unknown
): InternalPersistFrequencySnapshotsInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "keywordId",
    "keywordVersion",
    "observedAt",
    "snapshots"
  ]);
  const snapshots = frequencySnapshotValues(input.snapshots, "snapshots");
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    jobId: uuid(input.jobId, "jobId"),
    keywordId: uuid(input.keywordId, "keywordId"),
    keywordVersion: integer(input.keywordVersion, "keywordVersion"),
    observedAt: timestamp(input.observedAt),
    snapshots
  };
}

export function internalPersistFrequencySnapshotBatchInput(
  value: unknown
): InternalPersistFrequencySnapshotBatchInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "observedAt",
    "items"
  ]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalFrequencyPersistBatchLimit
  ) {
    invalid("items");
  }
  const items = input.items.map((value, index) => {
    const item = record(value, ["keywordId", "keywordVersion", "snapshots"]);
    return {
      keywordId: uuid(item.keywordId, `items.${index}.keywordId`),
      keywordVersion: integer(
        item.keywordVersion,
        `items.${index}.keywordVersion`
      ),
      snapshots: frequencySnapshotValues(
        item.snapshots,
        `items.${index}.snapshots`
      )
    };
  });
  if (new Set(items.map((item) => item.keywordId)).size !== items.length) {
    invalid("items");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    jobId: uuid(input.jobId, "jobId"),
    observedAt: timestamp(input.observedAt),
    items
  };
}

function frequencySnapshotValues(
  value: unknown,
  field: string
): readonly InternalFrequencySnapshotValue[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > semanticFrequencyTypes.length) {
    invalid(field);
  }
  const snapshots = value.map((value, index) => {
    const snapshot = record(value, [
      "type",
      "regionCode",
      "device",
      "period",
      "value",
      "provider",
      "sourceMode",
      "qualityFlags"
    ]);
    if (
      typeof snapshot.type !== "string" ||
      !semanticFrequencyTypes.includes(snapshot.type as SemanticFrequencyType)
    ) invalid(`${field}.${index}.type`);
    if (typeof snapshot.regionCode !== "string" || !REGION_PATTERN.test(snapshot.regionCode)) {
      invalid(`${field}.${index}.regionCode`);
    }
    if (
      typeof snapshot.device !== "string" ||
      !semanticFrequencyDevices.includes(snapshot.device as never)
    ) invalid(`${field}.${index}.device`);
    if (
      snapshot.period !== undefined &&
      (typeof snapshot.period !== "string" ||
        !/^[0-9A-Za-z._:-]{1,32}$/u.test(snapshot.period))
    ) invalid(`${field}.${index}.period`);
    if (typeof snapshot.value !== "string" || !DECIMAL_PATTERN.test(snapshot.value)) {
      invalid(`${field}.${index}.value`);
    }
    if (
      typeof snapshot.provider !== "string" ||
      !frequencyCollectionProviders.includes(snapshot.provider as never) ||
      snapshot.sourceMode !== "BYOK"
    ) {
      invalid(`${field}.${index}.provider`);
    }
    if (
      !Array.isArray(snapshot.qualityFlags) ||
      snapshot.qualityFlags.length > semanticFrequencyQualityFlags.length ||
      snapshot.qualityFlags.some(
        (flag) =>
          typeof flag !== "string" ||
          !semanticFrequencyQualityFlags.includes(flag as never)
      ) ||
      new Set(snapshot.qualityFlags).size !== snapshot.qualityFlags.length
    ) invalid(`${field}.${index}.qualityFlags`);
    return {
      type: snapshot.type as SemanticFrequencyType,
      regionCode: snapshot.regionCode,
      device: snapshot.device as (typeof semanticFrequencyDevices)[number],
      ...(typeof snapshot.period === "string" ? { period: snapshot.period } : {}),
      value: snapshot.value,
      provider: snapshot.provider as (typeof frequencyCollectionProviders)[number],
      sourceMode: "BYOK" as const,
      qualityFlags: snapshot.qualityFlags as (typeof semanticFrequencyQualityFlags)[number][]
    };
  });
  if (new Set(snapshots.map(({ type, regionCode, device }) => `${type}:${regionCode}:${device}`)).size !== snapshots.length) {
    invalid(field);
  }
  return snapshots;
}

function record(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(field);
  return value.toLowerCase();
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid("observedAt");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid("observedAt");
  return value;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid frequency command ${field}`);
}
