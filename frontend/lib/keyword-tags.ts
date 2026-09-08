import type { UpdateSemanticKeywordInput } from "@seo-platform/contracts";

export function normalizeKeywordTag(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
export function keywordTagKey(value: string): string { return normalizeKeywordTag(value).toLowerCase(); }

/** No delimiter parsing: a comma is a valid character inside one tag. */
export function uniqueKeywordTags(values: readonly string[]): readonly string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = normalizeKeywordTag(value);
    if (name && !names.has(keywordTagKey(name))) names.set(keywordTagKey(name), name);
  }
  return [...names.values()];
}

/** Emit exact changes only, preserving tags not present in a UI projection. */
export function keywordTagChanges(before: readonly string[], after: readonly string[]): Pick<UpdateSemanticKeywordInput, "addTagNames" | "removeTagNames"> {
  const initial = uniqueKeywordTags(before), next = uniqueKeywordTags(after);
  const initialKeys = new Set(initial.map(keywordTagKey)), nextKeys = new Set(next.map(keywordTagKey));
  const add = next.filter(tag => !initialKeys.has(keywordTagKey(tag)));
  const remove = initial.filter(tag => !nextKeys.has(keywordTagKey(tag)));
  return { ...(add.length ? { addTagNames: add } : {}), ...(remove.length ? { removeTagNames: remove } : {}) };
}
