import { rankProviderKeywordLimit } from "@seo-platform/contracts";

export interface RankJobItemReference {
  readonly manifestId: string;
  readonly chunkIndex: number;
}

export function rankJobItemReference(
  value: unknown
): RankJobItemReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const fields = ["schemaVersion", "manifestId", "chunkIndex"];
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    input.schemaVersion !== "rank-job-item@1" ||
    typeof input.manifestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      input.manifestId
    ) ||
    !Number.isSafeInteger(input.chunkIndex) ||
    Number(input.chunkIndex) < 0 ||
    Number(input.chunkIndex) >= rankProviderKeywordLimit
  ) {
    invalid();
  }
  return {
    manifestId: input.manifestId,
    chunkIndex: Number(input.chunkIndex)
  };
}

function invalid(): never {
  throw new Error("Invalid rank JobItem manifest reference");
}
