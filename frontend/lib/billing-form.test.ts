import assert from "node:assert/strict";
import test from "node:test";
import {
  billingBuyerBusinessFields,
  billingDeliveryEmail,
  billingRublesToMinor
} from "./billing-form.ts";

test("individual checkout drops hidden business values", () => {
  assert.deepEqual(
    billingBuyerBusinessFields(
      "INDIVIDUAL",
      "Previously selected LLC",
      "1234567890"
    ),
    { value: {} }
  );
});

test("business checkout validates the exact Russian INN shape", () => {
  assert.deepEqual(
    billingBuyerBusinessFields(
      "INDIVIDUAL_ENTREPRENEUR",
      " ИП Тест ",
      "123456789012"
    ),
    {
      value: { buyerName: "ИП Тест", buyerInn: "123456789012" }
    }
  );
  assert.deepEqual(
    billingBuyerBusinessFields(
      "LEGAL_ENTITY",
      "ООО Тест",
      "123456789012"
    ),
    { error: "ИНН должен содержать 10 цифр." }
  );
});

test("receipt email is normalized before checkout", () => {
  assert.deepEqual(billingDeliveryEmail(" Owner@Example.Test "), {
    value: "owner@example.test"
  });
  assert.deepEqual(billingDeliveryEmail("owner@localhost"), {
    error: "Укажите корректный email для чека."
  });
});

test("money parser is decimal-exact and mirrors the server maximum", () => {
  assert.equal(billingRublesToMinor("100"), 10_000);
  assert.equal(billingRublesToMinor("100.5"), 10_050);
  assert.equal(billingRublesToMinor("0.01"), 1);
  assert.equal(billingRublesToMinor("1000000"), 100_000_000);
  for (const invalid of [
    "00.01",
    "1.001",
    "1e3",
    "-1",
    "1000000.01",
    "1000001"
  ]) {
    assert.equal(billingRublesToMinor(invalid), undefined);
  }
});

test("money parser enforces the operation-specific server minimum", () => {
  assert.equal(billingRublesToMinor("99.99", 10_000), undefined);
  assert.equal(billingRublesToMinor("100", 10_000), 10_000);
  assert.equal(billingRublesToMinor("0.99", 100), undefined);
  assert.equal(billingRublesToMinor("1", 100), 100);
  assert.throws(
    () => billingRublesToMinor("1", 0),
    /Invalid billing minimum/u
  );
});
