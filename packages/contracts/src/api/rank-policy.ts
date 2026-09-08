/** Immutable execution policies. Never widen an already published policy. */
export const rankCommandKeywordLimit = 300_000 as const;
export const rankCommandOverflowCount = 300_001 as const;
export const batchedArsenkinRankChunkSize = 5_000 as const;
export const batchedArsenkinRankPolicyVersion = "manual-arsenkin-positions@3.0.0" as const;
export const largeXmlStockRankPolicyVersion = "manual-xmlstock-serp@2.0.0" as const;

export interface RankExecutionPolicyShape {
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly commandLimit: number;
  readonly chunkSize: number;
}
const policies: Readonly<Record<string, RankExecutionPolicyShape>> = {
  "manual-arsenkin-positions@1.0.0": { provider: "ARSENKIN", commandLimit: 1000, chunkSize: 250 },
  "manual-arsenkin-positions@2.0.0": { provider: "ARSENKIN", commandLimit: 15000, chunkSize: 15000 },
  [batchedArsenkinRankPolicyVersion]: { provider: "ARSENKIN", commandLimit: rankCommandKeywordLimit, chunkSize: batchedArsenkinRankChunkSize },
  "manual-xmlstock-serp@1.0.0": { provider: "XMLSTOCK", commandLimit: 15000, chunkSize: 1 },
  [largeXmlStockRankPolicyVersion]: { provider: "XMLSTOCK", commandLimit: rankCommandKeywordLimit, chunkSize: 1 }
};

export function rankExecutionPolicyShape(version: unknown, provider?: "ARSENKIN" | "XMLSTOCK"): RankExecutionPolicyShape | undefined {
  const result = typeof version === "string" && Object.hasOwn(policies, version) ? policies[version] : undefined;
  return result && (!provider || result.provider === provider) ? result : undefined;
}
export function rankPolicyTaskCount(shape: RankExecutionPolicyShape, keywordCount: number): number {
  return Number.isSafeInteger(keywordCount) && keywordCount > 0 && keywordCount <= shape.commandLimit ? Math.ceil(keywordCount / shape.chunkSize) : 0;
}
export function rankPolicyMatchesManifest(version: unknown, provider: "ARSENKIN" | "XMLSTOCK", pairCount: number, chunkCount: number, chunkSize: number): boolean {
  const policy = rankExecutionPolicyShape(version, provider);
  return Boolean(policy && Number.isSafeInteger(pairCount) && pairCount > 0 && pairCount <= policy.commandLimit && chunkSize === policy.chunkSize && chunkCount === Math.ceil(pairCount / policy.chunkSize));
}
/** Read compatibility where a persisted header already seals its chunk size. */
export function rankManifestShapeIsSupported(provider: "ARSENKIN" | "XMLSTOCK", pairCount: number, chunkCount: number, chunkSize: number): boolean {
  return Object.keys(policies).some(version => rankPolicyMatchesManifest(version, provider, pairCount, chunkCount, chunkSize));
}
