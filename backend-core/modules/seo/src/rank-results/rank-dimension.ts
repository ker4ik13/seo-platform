import { BadRequestException } from "@nestjs/common";
import { parseSemanticRankDimensionKey, semanticRankDimensionKey, type SemanticRankDimension } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export function rankDimensionConfigurationWhere(key: string): Prisma.TrackingContextVersionWhereInput {
  const dimension = parseSemanticRankDimensionKey(key);
  if (!dimension) throw new BadRequestException("Invalid geographic rank dimension");
  return {
    searchEngine: dimension.searchEngine, countryCode: dimension.countryCode,
    language: dimension.language, device: dimension.device,
    OR: [{ regionCode: dimension.regionCode }, { regionCode: null, countryCode: dimension.regionCode }]
  };
}

export function rankDimensionMetadata(configuration: {
  searchEngine: "YANDEX" | "GOOGLE"; countryCode: string; regionCode: string | null;
  regionLabel: string | null; language: string; device: "DESKTOP" | "MOBILE";
}) {
  const dimension: Omit<SemanticRankDimension, "key"> = {
    searchEngine: configuration.searchEngine, countryCode: configuration.countryCode,
    regionCode: configuration.regionCode ?? configuration.countryCode, language: configuration.language,
    device: configuration.device, ...(configuration.regionLabel ? { regionLabel: configuration.regionLabel } : {})
  };
  return { ...dimension, dimensionKey: semanticRankDimensionKey(dimension) };
}
