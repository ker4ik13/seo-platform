import {
  aiAnswerDevices,
  aiAnswerSearchEngines,
  arsenkinAiAnswerKeywordLimit,
  type CreateAiAnswerCollectionInput
} from "@seo-platform/contracts";
import { domainToASCII } from "node:url";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function createAiAnswerCollectionInput(value: unknown): CreateAiAnswerCollectionInput {
  const input = record(value, [
    "items", "searchEngine", "regionCode", "device", "host",
    "excludeSubdomains", "brands"
  ]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > arsenkinAiAnswerKeywordLimit) {
    invalid("items");
  }
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, ["id", "version"]);
    if (typeof item.id !== "string" || !UUID_PATTERN.test(item.id)) invalid(`items.${index}.id`);
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) invalid(`items.${index}.version`);
    return { id: item.id.toLowerCase(), version: Number(item.version) };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  if (typeof input.searchEngine !== "string" || !aiAnswerSearchEngines.includes(input.searchEngine as never)) {
    invalid("searchEngine");
  }
  if (typeof input.regionCode !== "string" || !/^(?:0|[1-9]\d{0,9})$/u.test(input.regionCode)) {
    invalid("regionCode");
  }
  if (typeof input.device !== "string" || !aiAnswerDevices.includes(input.device as never)) invalid("device");
  if (typeof input.host !== "string") invalid("host");
  const host = domainToASCII(
    input.host.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, "")
  );
  if (!HOST_PATTERN.test(host)) invalid("host");
  if (typeof input.excludeSubdomains !== "boolean") invalid("excludeSubdomains");
  if (!Array.isArray(input.brands) || input.brands.length > 10) invalid("brands");
  const brands = input.brands.map((value, index) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 160) invalid(`brands.${index}`);
    return value.trim();
  });
  if (new Set(brands.map((brand) => brand.toLocaleLowerCase("ru-RU"))).size !== brands.length) invalid("brands");
  return {
    items,
    searchEngine: input.searchEngine as CreateAiAnswerCollectionInput["searchEngine"],
    regionCode: input.regionCode,
    device: input.device as CreateAiAnswerCollectionInput["device"],
    host,
    excludeSubdomains: input.excludeSubdomains,
    brands
  };
}

export function aiAnswerIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) invalid("Idempotency-Key");
  return value;
}

export function aiAnswerCancelInput(value: unknown): Record<string, never> {
  record(value, []);
  return {};
}

function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("body");
  return input;
}

function invalid(field: string): never {
  throw validationError(field, "INVALID", "Invalid AI answer collection request");
}
