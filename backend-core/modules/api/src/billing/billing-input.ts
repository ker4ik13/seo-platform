import { createHash } from "node:crypto";
import {
  billingBuyerTypes,
  billingPaymentProviders,
  type BillingPaymentProvider,
  type OnlineBillingPaymentProvider,
  billingPeriods,
  type BillingBuyerType,
  type BillingPeriod,
  type CreateBillingCheckoutInput,
  type CreateBillingRefundInput,
  type CreateBillingTopUpInput
} from "@seo-platform/contracts";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import { validationError } from "../common/domain-error.js";
import {
  booleanField,
  inputObject,
  optionalStringField,
  stringField
} from "../common/input.js";

const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TERMS_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/u;
const WEBHOOK_EVENTS = new Set([
  "payment.waiting_for_capture",
  "payment.succeeded",
  "payment.canceled",
  "refund.succeeded"
]);

export interface YookassaWebhookInput {
  readonly provider?: BillingPaymentProvider;
  readonly event: string;
  readonly objectType: "payment" | "refund";
  readonly objectId: string;
  readonly objectStatus: string;
  readonly fingerprint: string;
  readonly payloadHash: Uint8Array<ArrayBuffer>;
}

export function billingCheckoutInput(
  value: unknown
): CreateBillingCheckoutInput {
  const input = inputObject(value);
  const planCode = stringField(input, "planCode", {
    min: 2,
    max: 32
  }).toUpperCase();
  if (!PLAN_CODE_PATTERN.test(planCode) || planCode === "TRIAL") {
    invalid("planCode", "INVALID_PLAN", "Select a paid plan");
  }
  if (input.planVersion !== undefined && (!Number.isSafeInteger(input.planVersion) || Number(input.planVersion) < 1 || Number(input.planVersion) > 10000)) invalid("planVersion", "INVALID_VERSION", "Select a published plan version");
  return {
    planCode,
    ...(input.planVersion === undefined ? {} : { planVersion: Number(input.planVersion) }),
    period: periodField(input.period),
    ...buyerFields(input),
    ...checkoutConsent(input),
    ...paymentProvider(input.provider)
  };
}

export function billingTopUpInput(
  value: unknown
): CreateBillingTopUpInput {
  const input = inputObject(value);
  return {
    amountMinor: moneyInteger(input.amountMinor, "amountMinor", 10_000),
    ...buyerFields(input),
    ...checkoutConsent(input),
    ...paymentProvider(input.provider)
  };
}

export function billingRefundInput(
  value: unknown
): CreateBillingRefundInput {
  const input = inputObject(value);
  return {
    amountMinor: moneyInteger(input.amountMinor, "amountMinor", 1),
    reason: stringField(input, "reason", {
      min: 3,
      max: 500
    }).normalize("NFC")
  };
}

export function yookassaWebhookInput(value: unknown): YookassaWebhookInput {
  const input = inputObject(value);
  if (input.type !== "notification") {
    invalid("type", "INVALID_WEBHOOK", "Invalid webhook type");
  }
  if (typeof input.event !== "string" || !WEBHOOK_EVENTS.has(input.event)) {
    invalid("event", "INVALID_WEBHOOK_EVENT", "Unsupported webhook event");
  }
  const object = inputObject(input.object);
  const objectType = input.event.split(".")[0];
  if (objectType !== "payment" && objectType !== "refund") {
    invalid("event", "INVALID_WEBHOOK_EVENT", "Unsupported webhook event");
  }
  if (
    typeof object.id !== "string" ||
    !PROVIDER_ID_PATTERN.test(object.id)
  ) {
    invalid("object.id", "INVALID_WEBHOOK", "Invalid provider object ID");
  }
  if (
    typeof object.status !== "string" ||
    !/^[a-z_]{2,40}$/u.test(object.status)
  ) {
    invalid("object.status", "INVALID_WEBHOOK", "Invalid provider status");
  }
  const canonicalPayload = canonicalizeJson(value);
  const fingerprint = createHash("sha256")
    .update(
      [
        "yookassa-webhook@1",
        input.event,
        object.id,
        object.status
      ].join("\u0000"),
      "utf8"
    )
    .digest("hex");
  return {
    event: input.event,
    objectType,
    objectId: object.id,
    objectStatus: object.status,
    fingerprint,
    payloadHash: Uint8Array.from(
      createHash("sha256")
        .update(canonicalPayload, "utf8")
        .digest()
    )
  };
}

function buyerFields(
  input: Readonly<Record<string, unknown>>
): Pick<
  CreateBillingCheckoutInput,
  "buyerType" | "buyerName" | "buyerInn" | "deliveryEmail"
> {
  const buyerType = buyerTypeField(input.buyerType);
  const buyerName = optionalStringField(input, "buyerName", {
    min: 2,
    max: 200
  })?.normalize("NFC");
  const buyerInn = optionalStringField(input, "buyerInn", {
    min: 10,
    max: 12
  });
  if (buyerType !== "INDIVIDUAL" && !buyerName) {
    invalid(
      "buyerName",
      "BUYER_NAME_REQUIRED",
      "Buyer name is required for business checkout"
    );
  }
  if (
    (buyerType === "INDIVIDUAL_ENTREPRENEUR" &&
      !/^[0-9]{12}$/u.test(buyerInn ?? "")) ||
    (buyerType === "LEGAL_ENTITY" &&
      !/^[0-9]{10}$/u.test(buyerInn ?? ""))
  ) {
    invalid(
      "buyerInn",
      "INVALID_BUYER_INN",
      "Enter a valid Russian taxpayer number"
    );
  }
  if (buyerType === "INDIVIDUAL" && buyerInn) {
    invalid(
      "buyerInn",
      "BUYER_INN_NOT_ALLOWED",
      "Taxpayer number requires a business buyer type"
    );
  }
  const deliveryEmail = stringField(input, "deliveryEmail", {
    min: 3,
    max: 320
  })
    .normalize("NFKC")
    .toLowerCase();
  if (!EMAIL_PATTERN.test(deliveryEmail)) {
    invalid(
      "deliveryEmail",
      "INVALID_EMAIL",
      "Enter a valid delivery email"
    );
  }
  return {
    buyerType,
    ...(buyerName ? { buyerName } : {}),
    ...(buyerInn ? { buyerInn } : {}),
    deliveryEmail
  };
}

function checkoutConsent(
  input: Readonly<Record<string, unknown>>
): Pick<
  CreateBillingCheckoutInput,
  "savePaymentMethod" | "termsAccepted" | "termsVersion"
> {
  const termsAccepted = booleanField(input, "termsAccepted");
  if (!termsAccepted) {
    invalid(
      "termsAccepted",
      "CONSENT_REQUIRED",
      "Terms must be accepted before payment"
    );
  }
  const termsVersion = stringField(input, "termsVersion", {
    min: 1,
    max: 64
  });
  if (!TERMS_VERSION_PATTERN.test(termsVersion)) {
    invalid(
      "termsVersion",
      "INVALID_TERMS_VERSION",
      "Invalid terms version"
    );
  }
  return {
    savePaymentMethod: booleanField(input, "savePaymentMethod"),
    termsAccepted: true,
    termsVersion
  };
}

function periodField(value: unknown): BillingPeriod {
  if (
    typeof value !== "string" ||
    !billingPeriods.some((period) => period === value)
  ) {
    invalid("period", "INVALID_BILLING_PERIOD", "Select a billing period");
  }
  return value as BillingPeriod;
}

function buyerTypeField(value: unknown): BillingBuyerType {
  if (
    typeof value !== "string" ||
    !billingBuyerTypes.some((type) => type === value)
  ) {
    invalid("buyerType", "INVALID_BUYER_TYPE", "Select a buyer type");
  }
  return value as BillingBuyerType;
}

function moneyInteger(
  value: unknown,
  path: string,
  minimum: number
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > 100_000_000
  ) {
    invalid(
      path,
      "INVALID_AMOUNT",
      `Amount must be an integer between ${minimum} and 100000000 minor units`
    );
  }
  return Number(value);
}

function invalid(path: string, code: string, message: string): never {
  throw validationError(path, code, message);
}

function paymentProvider(value: unknown): { provider?: OnlineBillingPaymentProvider } {
  if (value === undefined || value === "YOOKASSA") return {};
  if (!billingPaymentProviders.includes(value as OnlineBillingPaymentProvider)) invalid("provider", "INVALID_PROVIDER", "Unsupported payment provider");
  return { provider: value as OnlineBillingPaymentProvider };
}
