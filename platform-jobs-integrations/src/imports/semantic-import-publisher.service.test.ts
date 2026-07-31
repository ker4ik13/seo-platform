import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalPublishRow } from "./semantic-import-publisher.service.js";

test("canonicalizes PostgreSQL JSON field order before hashing a publish chunk", () => {
  const storedJson = {
    language: "ru",
    groupPath: ["Коммерция"],
    frequencies: [{ type: "BASE", value: "120" }],
    customValues: {},
    textOriginal: "продвижение сайта",
    normalizedHash:
      "cacd6fa1a0ad9f9bac9c50c5c6bccd047a38d2d9775a2b0e7373b54cf67d677c",
    textNormalized: "продвижение сайта",
    sourceRowNumber: "2"
  };

  const canonical = canonicalPublishRow(storedJson);

  assert.ok(canonical);
  assert.deepEqual(Object.keys(canonical), [
    "sourceRowNumber",
    "textOriginal",
    "textNormalized",
    "normalizedHash",
    "language",
    "groupPath",
    "frequencies",
    "customValues"
  ]);
  assert.equal(
    sha256([canonical]),
    sha256([
      {
        sourceRowNumber: "2",
        textOriginal: "продвижение сайта",
        textNormalized: "продвижение сайта",
        normalizedHash:
          "cacd6fa1a0ad9f9bac9c50c5c6bccd047a38d2d9775a2b0e7373b54cf67d677c",
        language: "ru",
        groupPath: ["Коммерция"],
        frequencies: [{ type: "BASE", value: "120" }],
        customValues: {}
      }
    ])
  );
});

test("rejects non-string custom values and malformed optional fields", () => {
  const required = {
    sourceRowNumber: "1",
    textOriginal: "SEO",
    textNormalized: "seo",
    normalizedHash: "a".repeat(64),
    language: "ru",
    customValues: {}
  };

  assert.equal(
    canonicalPublishRow({
      ...required,
      customValues: { score: 42 }
    }),
    undefined
  );
  assert.equal(
    canonicalPublishRow({ ...required, targetUrl: 42 }),
    undefined
  );
});

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
