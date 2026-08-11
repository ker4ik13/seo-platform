import assert from "node:assert/strict";
import test from "node:test";
import {
  readLastRankCredentialId,
  writeLastRankCredentialId
} from "./rank-credential-preference.ts";

test("stores an exact project-scoped rank credential", () => {
  const storage = memoryStorage();
  writeLastRankCredentialId(storage, "project-a", "credential-a");
  writeLastRankCredentialId(storage, "project-b", "credential-b");

  assert.equal(
    readLastRankCredentialId(storage, "project-a", ["credential-a", "credential-c"]),
    "credential-a"
  );
  assert.equal(
    readLastRankCredentialId(storage, "project-b", ["credential-b"]),
    "credential-b"
  );
});

test("does not label a removed or inaccessible credential as last used", () => {
  const storage = memoryStorage();
  writeLastRankCredentialId(storage, "project-a", "credential-old");

  assert.equal(
    readLastRankCredentialId(storage, "project-a", ["credential-current"]),
    undefined
  );
  assert.equal(storage.getItem("seo:last-rank-credential:project-a"), null);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}
