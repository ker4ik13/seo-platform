import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { semanticKeywordPage } from "./seo-data.client.js";

const validItem = {
  id: "01900000-0000-7000-8000-000000000010",
  textOriginal: "SEO аудит",
  textNormalized: "seo аудит",
  language: "ru",
  priority: 0,
  isTracked: false,
  groupPath: "Услуги / SEO",
  targetUrl: "https://example.com/seo",
  tags: ["Приоритет"],
  tagsTruncated: false,
  sourceMode: "IMPORT",
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:00:00.000Z",
  version: 1
};

test("accepts a strictly shaped semantic keyword page", () => {
  const result = semanticKeywordPage({
    data: [validItem],
    page: { hasNext: false, totalApprox: 1 },
    meta: { requestId: "internal-request" }
  });

  assert.equal(result.data[0]?.textOriginal, "SEO аудит");
  assert.deepEqual(result.page, { hasNext: false, totalApprox: 1 });
});

test("rejects malformed SEO data responses", () => {
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [{ ...validItem, sourceMode: "UNKNOWN" }],
        page: { hasNext: false }
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [validItem],
        page: { hasNext: "false" }
      }),
    DomainError
  );
});
