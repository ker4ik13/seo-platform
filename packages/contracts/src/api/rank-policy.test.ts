import assert from "node:assert/strict";
import test from "node:test";
import { batchedArsenkinRankPolicyVersion, largeXmlStockRankPolicyVersion, rankExecutionPolicyShape, rankPolicyMatchesManifest, rankPolicyTaskCount } from "./rank-policy.js";
test("50k rank policies preserve historical provider bounds and accept old sentinel counts as data", () => {
  const batched = rankExecutionPolicyShape(batchedArsenkinRankPolicyVersion, "ARSENKIN")!;
  assert.equal(rankPolicyTaskCount(batched, 50000), 10);
  assert.equal(rankPolicyTaskCount(batched, 1001), 1);
  assert.equal(rankPolicyTaskCount(batched, 15001), 4);
  assert.equal(rankPolicyTaskCount(batched, 300001), 0);
  assert.equal(rankPolicyTaskCount(rankExecutionPolicyShape("manual-arsenkin-positions@2.0.0")!, 15001), 0);
  assert.equal(rankPolicyTaskCount(rankExecutionPolicyShape(largeXmlStockRankPolicyVersion)!, 50000), 50000);
  assert.equal(rankPolicyMatchesManifest(largeXmlStockRankPolicyVersion, "XMLSTOCK", 3, 3, 1), true);
  assert.equal(rankPolicyMatchesManifest(batchedArsenkinRankPolicyVersion, "ARSENKIN", 50000, 10, 5000), true);
  assert.equal(rankPolicyMatchesManifest(batchedArsenkinRankPolicyVersion, "ARSENKIN", 50000, 1, 50000), false);
  assert.equal(rankExecutionPolicyShape(batchedArsenkinRankPolicyVersion, "XMLSTOCK"), undefined);
  assert.equal(rankExecutionPolicyShape("__proto__"), undefined);
});
