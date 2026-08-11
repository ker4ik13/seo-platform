import assert from "node:assert/strict";
import test from "node:test";
import {
  readSemanticManualAddPreferences,
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

test("keeps the duplicate choice isolated per project", () => {
  const storage = new MemoryStorage();
  writeSemanticManualAddPreferences(
    "project-a",
    { skipDuplicates: false },
    storage
  );

  assert.deepEqual(readSemanticManualAddPreferences("project-a", storage), {
    skipDuplicates: false
  });
  assert.deepEqual(readSemanticManualAddPreferences("project-b", storage), {
    skipDuplicates: true
  });
});

test("falls back to safe duplicate skipping for malformed storage", () => {
  const storage = new MemoryStorage();
  storage.setItem("seonorita:semantic-manual-add:v1:broken", "{");
  assert.deepEqual(readSemanticManualAddPreferences("broken", storage), {
    skipDuplicates: true
  });
});
