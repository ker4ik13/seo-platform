import type { CreateRankEstimateInput } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createRankEstimateInput(
  value: unknown
): CreateRankEstimateInput {
  const input = exactRecord(value);
  if (
    input.purpose !== undefined &&
    input.purpose !== "POSITION_TRACKING" &&
    input.purpose !== "COMPETITOR_SERP"
  ) {
    throw validationError(
      "purpose",
      "INVALID_ENUM",
      "Must be POSITION_TRACKING or COMPETITOR_SERP"
    );
  }
  if (
    input.saveProjectPosition !== undefined &&
    typeof input.saveProjectPosition !== "boolean"
  ) {
    throw validationError(
      "saveProjectPosition",
      "INVALID_TYPE",
      "Must be a boolean"
    );
  }
  if (
    input.saveProjectPosition !== undefined &&
    input.purpose !== "COMPETITOR_SERP"
  ) {
    throw validationError(
      "saveProjectPosition",
      "INVALID_COMBINATION",
      "Available only for COMPETITOR_SERP"
    );
  }
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
  if (
    input.xmlStockDepthMode !== undefined &&
    input.xmlStockDepthMode !== "STRICT_DEPTH" &&
    input.xmlStockDepthMode !== "STOP_AFTER_FOUND"
  ) {
    throw validationError(
      "xmlStockDepthMode",
      "INVALID_ENUM",
      "Must be STRICT_DEPTH or STOP_AFTER_FOUND"
    );
  }
  if (
    input.xmlStockDepthMode !== undefined &&
    (input.provider !== "XMLSTOCK" || input.purpose === "COMPETITOR_SERP")
  ) {
    throw validationError(
      "xmlStockDepthMode",
      "INVALID_COMBINATION",
      "Available only for XMLSTOCK position tracking"
    );
  }
  return {
    trackingContextId: input.trackingContextId.toLowerCase(),
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(typeof input.saveProjectPosition === "boolean"
      ? { saveProjectPosition: input.saveProjectPosition }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(typeof input.credentialId === "string"
      ? { credentialId: input.credentialId.toLowerCase() }
      : {}),
    ...(input.searchSource ? { searchSource: input.searchSource } : {}),
    ...(input.yandexLiveMode === "TURBO"
      ? { yandexLiveMode: "TURBO" as const }
      : {}),
    ...(input.xmlStockDepthMode
      ? { xmlStockDepthMode: input.xmlStockDepthMode }
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
        key !== "purpose" &&
        key !== "saveProjectPosition" &&
        key !== "provider" &&
        key !== "credentialId" &&
        key !== "searchSource" &&
        key !== "yandexLiveMode" &&
        key !== "xmlStockDepthMode"
    ) ||
    !Object.hasOwn(input, "trackingContextId")
  ) {
    throw validationError(
      "$",
      "UNKNOWN_FIELD",
      "Only trackingContextId, purpose, saveProjectPosition, provider, credentialId, searchSource, yandexLiveMode and xmlStockDepthMode are allowed"
    );
  }
  return input;
}
