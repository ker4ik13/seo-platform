/**
 * Reads the backwards-compatible execution override without interpreting the
 * rest of the editable launch profile. Old stored profiles intentionally
 * exclude per-keyword disabled queries.
 */
export function trackingContextIncludesUntracked(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored tracking context launch profile is invalid");
  }
  const includeUntracked = (
    value as Readonly<Record<string, unknown>>
  ).includeUntracked;
  if (includeUntracked === undefined) return false;
  if (typeof includeUntracked !== "boolean") {
    throw new Error("Stored tracking context launch profile is invalid");
  }
  return includeUntracked;
}
