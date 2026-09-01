import assert from "node:assert/strict";
import test from "node:test";
import {
  microToRubles,
  positiveMoneyMicro
} from "./rank-automation-money.ts";

test("converts a decimal charge cap without floating-point rounding", () => {
  assert.equal(positiveMoneyMicro("12,5"), "12500000");
  assert.equal(positiveMoneyMicro("0.000001"), "1");
  assert.equal(positiveMoneyMicro("9223372036854.775807"), "9223372036854775807");
  assert.equal(microToRubles("12500000"), "12.5");
});

test("rejects zero, excess precision and values outside PostgreSQL BIGINT", () => {
  assert.equal(positiveMoneyMicro("0"), undefined);
  assert.equal(positiveMoneyMicro("1.0000001"), undefined);
  assert.equal(positiveMoneyMicro("9223372036854.775808"), undefined);
  assert.equal(positiveMoneyMicro("10000000000000"), undefined);
});
