import assert from "node:assert/strict";
import test from "node:test";
import {
  isOperationResultId,
  operationResultApiPath,
  operationResultHref,
  operationResultKind,
  operationResultKinds,
  parseOperationResultHref
} from "./operation-result-routes.ts";

const id = "01900000-0000-7000-8000-000000000001";

test("accepts the four implemented async operation kinds", () => {
  assert.deepEqual(operationResultKinds, ["frequency", "rank", "crawl", "research"]);
  for (const kind of operationResultKinds) assert.equal(operationResultKind(kind), kind);
  assert.equal(operationResultKind("import"), undefined);
});

test("builds a typed private result route", () => {
  assert.equal(operationResultHref("frequency", id), `/app/tasks/frequency/${id}`);
  assert.equal(isOperationResultId(id), true);
  assert.equal(isOperationResultId("../semantics"), false);
  assert.throws(() => operationResultHref("rank", "bad"), TypeError);
});

test("recognizes only exact same-app operation result links", () => {
  assert.deepEqual(parseOperationResultHref(`/app/tasks/rank/${id}`), {
    kind: "rank",
    operationId: id
  });
  assert.deepEqual(parseOperationResultHref(`/app/tasks/frequency/${id}?source=notification`), {
    kind: "frequency",
    operationId: id
  });
  assert.equal(parseOperationResultHref("https://example.com/app/tasks/rank/" + id), undefined);
  assert.equal(parseOperationResultHref(`/app/tasks/unknown/${id}`), undefined);
  assert.equal(parseOperationResultHref("/app/tasks"), undefined);
});

test("builds exact same-origin result API routes for every operation", () => {
  assert.equal(
    operationResultApiPath(id, "frequency", id),
    `/app/api/projects/${id}/frequency-collections/${id}/result`
  );
  assert.equal(
    operationResultApiPath(id, "rank", id),
    `/app/api/projects/${id}/jobs/${id}/result`
  );
  assert.equal(
    operationResultApiPath(id, "research", id),
    `/app/api/projects/${id}/keyword-research-runs/${id}`
  );
  assert.equal(
    operationResultApiPath(id, "crawl", id, "100"),
    `/app/api/projects/${id}/crawls/${id}/result?limit=100&cursor=100`
  );
  assert.throws(
    () => operationResultApiPath("foreign", "rank", id),
    TypeError
  );
});
