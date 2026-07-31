import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  assignPlatformStaffRoleInput,
  registerManualNpdReceiptInput,
  replaceManualNpdReceiptInput
} from "./platform-admin-input.js";

const receipt = {
  officialReceiptId: "205ldfqqhc",
  officialReceiptUrl:
    "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
  registeredAt: "2026-07-30T12:00:00.000Z",
  amountChecked: true,
  buyerChecked: true,
  reason: "Checked against the confirmed provider payment"
} as const;

test("accepts only exact official My Tax print URLs", () => {
  assert.deepEqual(registerManualNpdReceiptInput(receipt), receipt);

  for (const officialReceiptUrl of [
    "http://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
    "https://evil.example/api/v1/receipt/220704837033/205ldfqqhc/print",
    "https://lknpd.nalog.ru.evil.example/api/v1/receipt/220704837033/205ldfqqhc/print",
    "https://lknpd.nalog.ru/api/v1/receipt/220704837033/other/print",
    "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print?redirect=x"
  ]) {
    assert.throws(
      () =>
        registerManualNpdReceiptInput({
          ...receipt,
          officialReceiptUrl
        }),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VALIDATION_FAILED"
    );
  }
});

test("requires explicit amount and buyer verification", () => {
  for (const changed of [
    { amountChecked: false },
    { buyerChecked: false }
  ]) {
    assert.throws(
      () => registerManualNpdReceiptInput({ ...receipt, ...changed }),
      DomainError
    );
  }
});

test("replacement captures both cancellation and replacement evidence", () => {
  const parsed = replaceManualNpdReceiptInput({
    ...receipt,
    cancellationOfficialReference: "cancel-205ldfqqhc",
    cancelledAt: "2026-07-30T12:05:00.000Z"
  });
  assert.equal(parsed.officialReceiptId, receipt.officialReceiptId);
  assert.equal(
    parsed.cancellationOfficialReference,
    "cancel-205ldfqqhc"
  );
});

test("accepts only known platform roles and UUID users", () => {
  const parsed = assignPlatformStaffRoleInput({
    userId: "01900000-0000-7000-8000-000000000001",
    roleCode: "FINANCE",
    reason: "Finance operations responsibility"
  });
  assert.equal(parsed.roleCode, "FINANCE");
  assert.throws(
    () =>
      assignPlatformStaffRoleInput({
        ...parsed,
        roleCode: "ROOT"
      }),
    DomainError
  );
});
