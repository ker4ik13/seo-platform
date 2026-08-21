import assert from "node:assert/strict";
import test from "node:test";
import {
  clusteringProposalSectionApiPath,
  isOperationResultId,
  mergeOperationResultRows,
  operationResultApiPath,
  operationResultHref,
  operationResultKind,
  operationResultKinds,
  parseOperationResultHref
} from "./operation-result-routes.ts";

const id = "01900000-0000-7000-8000-000000000001";

test("accepts the implemented async operation kinds", () => {
  assert.deepEqual(operationResultKinds, ["frequency", "ai-answer", "clustering", "rank", "crawl", "research"]);
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
    `/app/api/projects/${id}/frequency-collections/${id}/result?limit=200`
  );
  assert.equal(
    operationResultApiPath(id, "ai-answer", id),
    `/app/api/projects/${id}/ai-answer-collections/${id}/result?limit=200`
  );
  assert.equal(
    operationResultApiPath(id, "clustering", id),
    `/app/api/projects/${id}/clustering-runs/${id}/result?limit=200`
  );
  assert.equal(
    operationResultApiPath(id, "rank", id),
    `/app/api/projects/${id}/jobs/${id}/result?limit=200`
  );
  assert.equal(
    operationResultApiPath(id, "research", id),
    `/app/api/projects/${id}/keyword-research-runs/${id}`
  );
  assert.equal(
    operationResultApiPath(id, "crawl", id, { cursor: "100" }),
    `/app/api/projects/${id}/crawls/${id}/result?limit=1000&cursor=100`
  );
  assert.throws(
    () => operationResultApiPath("foreign", "rank", id),
    TypeError
  );
});

test("builds an independently paged clustering section route", () => {
  assert.equal(
    clusteringProposalSectionApiPath(id, id, id, {
      cursor: "199",
      limit: 200
    }),
    `/app/api/projects/${id}/clustering-runs/${id}/result/sections/${id}?limit=200&cursor=199`
  );
  assert.equal(
    clusteringProposalSectionApiPath(id, id, "unclustered"),
    `/app/api/projects/${id}/clustering-runs/${id}/result/sections/unclustered?limit=200`
  );
});

test("merges infinite-scroll pages by immutable sequence", () => {
  assert.deepEqual(
    mergeOperationResultRows(
      [
        { sequence: 0, value: "готово" },
        { sequence: 1, value: "ожидает" }
      ],
      [
        { sequence: 1, value: "готово" },
        { sequence: 2, value: "новая строка" }
      ]
    ),
    [
      { sequence: 0, value: "готово" },
      { sequence: 1, value: "готово" },
      { sequence: 2, value: "новая строка" }
    ]
  );
});
