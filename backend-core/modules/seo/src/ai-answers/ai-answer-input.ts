import { BadRequestException } from "@nestjs/common";
import { domainToASCII } from "node:url";
import {
  aiAnswerDevices,
  aiAnswerSearchEngines,
  internalAiAnswerPersistBatchLimit,
  internalAiAnswerResolveBatchLimit,
  type InternalPersistAiAnswerSnapshotBatchInput,
  type InternalResolveAiAnswerKeywordsInput
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function internalResolveAiAnswerKeywordsInput(
  value: unknown
): InternalResolveAiAnswerKeywordsInput {
  const input = record(value, ["workspaceId", "projectId", "actorId", "items"]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalAiAnswerResolveBatchLimit
  ) invalid("items");
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`, 1, Number.MAX_SAFE_INTEGER)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  return { ...scope(input), items };
}

export function internalPersistAiAnswerSnapshotBatchInput(
  value: unknown
): InternalPersistAiAnswerSnapshotBatchInput {
  const input = record(value, [
    "sourceMode",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "searchEngine",
    "regionCode",
    "device",
    "provider",
    "host",
    "observedAt",
    "items"
  ]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalAiAnswerPersistBatchLimit
  ) invalid("items");
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, [
      "keywordId",
      "keywordVersion",
      "positionTrackingEnabled",
      "snapshot"
    ]);
    if (typeof item.positionTrackingEnabled !== "boolean") {
      invalid(`items.${index}.positionTrackingEnabled`);
    }
    const snapshot = record(item.snapshot, [
      "answerPresent",
      "siteFound",
      "position",
      "rankingUrl",
      "brandFound",
      "answerMarkdown",
      "sources"
    ]);
    if (
      typeof snapshot.answerPresent !== "boolean" ||
      typeof snapshot.siteFound !== "boolean" ||
      typeof snapshot.brandFound !== "boolean"
    ) invalid(`items.${index}.snapshot`);
    const position = optionalInteger(snapshot.position, `items.${index}.snapshot.position`, 1, 100_000);
    const rankingUrl = optionalUrl(snapshot.rankingUrl, `items.${index}.snapshot.rankingUrl`);
    const answerMarkdown = optionalString(
      snapshot.answerMarkdown,
      `items.${index}.snapshot.answerMarkdown`,
      300_000
    );
    if (!Array.isArray(snapshot.sources) || snapshot.sources.length > 100) {
      invalid(`items.${index}.snapshot.sources`);
    }
    if (
      (position !== undefined) !== (rankingUrl !== undefined) ||
      snapshot.siteFound !== (position !== undefined && rankingUrl !== undefined) ||
      (!snapshot.answerPresent && (
        snapshot.siteFound ||
        snapshot.brandFound ||
        answerMarkdown !== undefined ||
        snapshot.sources.length > 0
      ))
    ) {
      invalid(`items.${index}.snapshot`);
    }
    const sources = snapshot.sources.map((candidate, sourceIndex) => {
      const source = record(candidate, ["providerId", "url", "title", "description"]);
      return {
        ...(source.providerId === undefined
          ? {}
          : {
              providerId: integer(
                source.providerId,
                `items.${index}.snapshot.sources.${sourceIndex}.providerId`,
                0,
                100_000
              )
            }),
        url: requiredUrl(source.url, `items.${index}.snapshot.sources.${sourceIndex}.url`),
        ...(optionalString(source.title, "title", 4_000) ? { title: optionalString(source.title, "title", 4_000)! } : {}),
        ...(optionalString(source.description, "description", 12_000)
          ? { description: optionalString(source.description, "description", 12_000)! }
          : {})
      };
    });
    return {
      keywordId: uuid(item.keywordId, `items.${index}.keywordId`),
      keywordVersion: integer(item.keywordVersion, `items.${index}.keywordVersion`, 1, Number.MAX_SAFE_INTEGER),
      positionTrackingEnabled: item.positionTrackingEnabled,
      snapshot: {
        answerPresent: snapshot.answerPresent,
        siteFound: snapshot.siteFound,
        ...(position === undefined ? {} : { position }),
        ...(rankingUrl === undefined ? {} : { rankingUrl }),
        brandFound: snapshot.brandFound,
        ...(answerMarkdown === undefined ? {} : { answerMarkdown }),
        sources
      }
    };
  });
  if (new Set(items.map(({ keywordId }) => keywordId)).size !== items.length) invalid("items");
  const observedAt = timestamp(input.observedAt, "observedAt");
  const host = normalizedHost(input.host);
  return {
    ...scope(input),
    jobId: uuid(input.jobId, "jobId"),
    searchEngine: member(input.searchEngine, aiAnswerSearchEngines, "searchEngine"),
    regionCode: pattern(input.regionCode, "regionCode", /^(?:0|[1-9]\d{0,9})$/u),
    device: member(input.device, aiAnswerDevices, "device"),
    provider: input.provider === "ARSENKIN" ? "ARSENKIN" : invalid("provider"),
    ...(input.sourceMode === undefined ? {} : { sourceMode: input.sourceMode === "PLATFORM" || input.sourceMode === "BYOK" ? input.sourceMode : invalid("sourceMode") }),
    host,
    observedAt,
    items
  };
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(field);
  return Number(value);
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  return value === undefined ? undefined : integer(value, field, minimum, maximum);
}

function optionalString(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) invalid(field);
  return value.trim() || undefined;
}

function requiredUrl(value: unknown, field: string): string {
  const result = optionalUrl(value, field);
  if (!result) invalid(field);
  return result;
}

function optionalUrl(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 8_192) invalid(field);
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) invalid(field);
    return url.toString();
  } catch {
    invalid(field);
  }
}

function normalizedHost(value: unknown): string {
  if (typeof value !== "string") invalid("host");
  const host = domainToASCII(
    value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, "")
  );
  if (!HOST_PATTERN.test(host)) invalid("host");
  return host;
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function member<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(field);
  return value;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid AI answer command ${field}`);
}
