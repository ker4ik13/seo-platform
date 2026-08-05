import {
  platformRoleCodes,
  type AssignPlatformStaffRoleInput,
  type CancelManualNpdReceiptInput,
  type PlatformRoleCode,
  type RegisterManualNpdReceiptInput,
  type ReplaceManualNpdReceiptInput,
  type RevokePlatformStaffRoleInput
} from "@seo-platform/contracts";
import {
  booleanField,
  inputObject,
  stringField
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

export function registerManualNpdReceiptInput(
  value: unknown
): RegisterManualNpdReceiptInput {
  const input = inputObject(value);
  const officialReceiptId = stringField(input, "officialReceiptId", {
    min: 6,
    max: 255
  });
  const officialReceiptUrl = officialNpdReceiptUrl(
    stringField(input, "officialReceiptUrl", { min: 20, max: 2_000 }),
    officialReceiptId
  );
  return {
    officialReceiptId,
    officialReceiptUrl,
    registeredAt: pastDate(input, "registeredAt"),
    amountChecked: requiredTrue(input, "amountChecked"),
    buyerChecked: requiredTrue(input, "buyerChecked"),
    reason: reason(input)
  };
}

export function cancelManualNpdReceiptInput(
  value: unknown
): CancelManualNpdReceiptInput {
  const input = inputObject(value);
  return {
    cancellationOfficialReference: stringField(
      input,
      "cancellationOfficialReference",
      { min: 6, max: 255 }
    ),
    cancelledAt: pastDate(input, "cancelledAt"),
    reason: reason(input)
  };
}

export function replaceManualNpdReceiptInput(
  value: unknown
): ReplaceManualNpdReceiptInput {
  const input = inputObject(value);
  const registered = registerManualNpdReceiptInput(input);
  const cancelled = cancelManualNpdReceiptInput(input);
  return { ...registered, ...cancelled };
}

export function assignPlatformStaffRoleInput(
  value: unknown
): AssignPlatformStaffRoleInput {
  const input = inputObject(value);
  const roleCode = stringField(input, "roleCode", {
    min: 3,
    max: 40
  });
  if (!platformRoleCodes.includes(roleCode as PlatformRoleCode)) {
    throw validationError(
      "roleCode",
      "INVALID_ENUM",
      "Unknown platform role"
    );
  }
  return {
    userId: assertUuid(
      stringField(input, "userId", { min: 36, max: 36 }),
      "userId"
    ),
    roleCode: roleCode as PlatformRoleCode,
    reason: reason(input)
  };
}

export function revokePlatformStaffRoleInput(
  value: unknown
): RevokePlatformStaffRoleInput {
  return { reason: reason(inputObject(value)) };
}

function officialNpdReceiptUrl(value: string, receiptId: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw validationError(
      "officialReceiptUrl",
      "INVALID_URL",
      "A valid official receipt URL is required"
    );
  }
  const path = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "lknpd.nalog.ru" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    path.length !== 6 ||
    path[0] !== "api" ||
    path[1] !== "v1" ||
    path[2] !== "receipt" ||
    !/^\d{10,16}$/u.test(path[3] ?? "") ||
    path[4] !== receiptId ||
    path[5] !== "print"
  ) {
    throw validationError(
      "officialReceiptUrl",
      "UNTRUSTED_RECEIPT_URL",
      "Use the exact HTTPS print URL issued by lknpd.nalog.ru"
    );
  }
  return url.toString();
}

function requiredTrue(
  input: Readonly<Record<string, unknown>>,
  field: string
): true {
  if (!booleanField(input, field)) {
    throw validationError(
      field,
      "CONFIRMATION_REQUIRED",
      "Explicit confirmation is required"
    );
  }
  return true;
}

function pastDate(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = stringField(input, field, { min: 20, max: 40 });
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() > Date.now() + 5 * 60_000
  ) {
    throw validationError(
      field,
      "INVALID_DATE",
      "Use a valid timestamp that is not in the future"
    );
  }
  return date.toISOString();
}

function reason(input: Readonly<Record<string, unknown>>): string {
  return stringField(input, "reason", { min: 8, max: 500 });
}
