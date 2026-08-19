import type { CreateRankEstimateInput } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createRankEstimateInput(
  value: unknown
): CreateRankEstimateInput {
  const input = exactRecord(value);
  if (
    typeof input.trackingContextId !== "string" ||
    !UUID_PATTERN.test(input.trackingContextId)
  ) {
    throw validationError(
      "trackingContextId",
      "INVALID_UUID",
      "Must be a valid UUID"
    );
  }
  if (
    input.provider !== undefined &&
    input.provider !== "ARSENKIN" &&
    input.provider !== "XMLSTOCK"
  ) {
    throw validationError(
      "provider",
      "INVALID_ENUM",
      "Must be ARSENKIN or XMLSTOCK"
    );
  }
  if (
    input.credentialId !== undefined &&
    (typeof input.credentialId !== "string" ||
      !UUID_PATTERN.test(input.credentialId))
  ) {
    throw validationError(
      "credentialId",
      "INVALID_UUID",
      "Must be a valid UUID"
    );
  }
  if (
    input.searchSource !== undefined &&
    input.searchSource !== "SEARCH_API" &&
    input.searchSource !== "LIVE"
  ) {
    throw validationError(
      "searchSource",
      "INVALID_ENUM",
      "Must be SEARCH_API or LIVE"
    );
  }
  if (
    input.yandexLiveMode !== undefined &&
    input.yandexLiveMode !== "TURBO"
  ) {
    throw validationError(
      "yandexLiveMode",
      "INVALID_ENUM",
      "Must be TURBO"
    );
  }
  if (
    input.yandexLiveMode === "TURBO" &&
    (input.provider !== "XMLSTOCK" || input.searchSource !== "LIVE")
  ) {
    throw validationError(
      "yandexLiveMode",
      "INVALID_COMBINATION",
      "Turbo is available only for an explicit XMLSTOCK Yandex Live estimate"
    );
  }
  return {
    trackingContextId: input.trackingContextId.toLowerCase(),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(typeof input.credentialId === "string"
      ? { credentialId: input.credentialId.toLowerCase() }
      : {}),
    ...(input.searchSource ? { searchSource: input.searchSource } : {}),
    ...(input.yandexLiveMode === "TURBO"
      ? { yandexLiveMode: "TURBO" as const }
      : {})
  };
}

function exactRecord(
  value: unknown
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw validationError(
      "$",
      "INVALID_TYPE",
      "Must be an object"
    );
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      (key) =>
        key !== "trackingContextId" &&
        key !== "provider" &&
        key !== "credentialId" &&
        key !== "searchSource" &&
        key !== "yandexLiveMode"
    ) ||
    !Object.hasOwn(input, "trackingContextId")
  ) {
    throw validationError(
      "$",
      "UNKNOWN_FIELD",
      "Only trackingContextId, provider, credentialId, searchSource and yandexLiveMode are allowed"
    );
  }
  return input;
}
