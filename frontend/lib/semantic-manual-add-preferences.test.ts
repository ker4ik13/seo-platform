import assert from "node:assert/strict";
import test from "node:test";
import {
  readSemanticManualAddPreferences,
  semanticManualDuplicateTargetGroupId,
  writeSemanticManualAddPreferences
} from "./semantic-manual-add-preferences.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("resolves a distinct target for every duplicate import mode", () => {
  assert.equal(
    semanticManualDuplicateTargetGroupId("SKIP_PROJECT", "primary", "current"),
    ""
  );
  assert.equal(
    semanticManualDuplicateTargetGroupId("PRESERVE_FOLDERS", "primary", "current"),
    "primary"
  );
  assert.equal(
    semanticManualDuplicateTargetGroupId("CURRENT_GROUP", "primary", "current"),
    "current"
  );
});

test("keeps the three-way duplicate choice isolated per project", () => {
  const storage = new MemoryStorage();
  writeSemanticManualAddPreferences(
    "project-a",
    { duplicateMode: "CURRENT_GROUP" },
    storage
  );

  assert.deepEqual(readSemanticManualAddPreferences("project-a", storage), {
    duplicateMode: "CURRENT_GROUP"
  });
  assert.deepEqual(readSemanticManualAddPreferences("project-b", storage), {
    duplicateMode: "SKIP_PROJECT"
  });
});

test("migrates both legacy duplicate switches into one mode", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "seonorita:semantic-manual-add:v1:legacy-import",
    JSON.stringify({ addDuplicatesToGroup: true, skipDuplicates: true })
  );
  storage.setItem(
    "seonorita:semantic-manual-add:v1:legacy-inverse",
    JSON.stringify({ skipDuplicates: false })
  );
  storage.setItem(
    "seonorita:semantic-manual-add:v1:legacy-skip",
    JSON.stringify({ skipDuplicates: true })
  );

  for (const projectId of ["legacy-import", "legacy-inverse"]) {
    assert.deepEqual(readSemanticManualAddPreferences(projectId, storage), {
      duplicateMode: "PRESERVE_FOLDERS"
    });
  }
  assert.deepEqual(readSemanticManualAddPreferences("legacy-skip", storage), {
    duplicateMode: "SKIP_PROJECT"
  });
});

test("falls back to safe project-wide skipping for malformed storage", () => {
  const storage = new MemoryStorage();
  storage.setItem("seonorita:semantic-manual-add:v2:broken", "{");
  assert.deepEqual(readSemanticManualAddPreferences("broken", storage), {
    duplicateMode: "SKIP_PROJECT"
  });
});
