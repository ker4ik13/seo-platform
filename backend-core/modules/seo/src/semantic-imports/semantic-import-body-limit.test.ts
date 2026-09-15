import assert from "node:assert/strict";
import test from "node:test";
import {
  applySemanticImportBodyLimit,
  SEMANTIC_IMPORT_CHUNK_BODY_LIMIT_BYTES,
  SEMANTIC_IMPORT_NORMALIZE_BODY_LIMIT_BYTES
} from "./semantic-import-body-limit.js";

test("widens only trusted semantic import normalization and chunk routes", () => {
  const chunk = {
    method: "POST",
    url: "/internal/v1/semantic-imports/01900000-0000-7000-8000-000000000001/chunks",
    bodyLimit: 1_048_576
  };
  const ordinary = {
    method: "POST",
    url: "/internal/v1/semantic-imports/01900000-0000-7000-8000-000000000001/begin",
    bodyLimit: 1_048_576
  };
  const normalize = {
    method: "POST",
    url: "/internal/v1/semantic-imports/01900000-0000-7000-8000-000000000001/normalize",
    bodyLimit: 1_048_576
  };

  applySemanticImportBodyLimit(chunk);
  applySemanticImportBodyLimit(normalize);
  applySemanticImportBodyLimit(ordinary);

  assert.equal(chunk.bodyLimit, SEMANTIC_IMPORT_CHUNK_BODY_LIMIT_BYTES);
  assert.equal(normalize.bodyLimit, SEMANTIC_IMPORT_NORMALIZE_BODY_LIMIT_BYTES);
  assert.equal(ordinary.bodyLimit, 1_048_576);
});
