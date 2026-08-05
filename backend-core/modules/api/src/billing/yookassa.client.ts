import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const PROVIDER_NETWORK_ATTEMPTS = 3;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/u;

export interface YookassaMoney {
  readonly value: string;
  readonly currency: string;
}

export interface YookassaPaymentMethod {
  readonly id?: string;
  readonly type: string;
  readonly saved: boolean;
  readonly title?: string;
}

export interface YookassaPayment {
  readonly id: string;
  readonly status:
    | "pending"
    | "waiting_for_capture"
    | "succeeded"
    | "canceled";
  readonly paid: boolean;
  readonly amount: YookassaMoney;
  readonly createdAt: string;
  readonly capturedAt?: string;
  readonly confirmationUrl?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly paymentMethod?: YookassaPaymentMethod;
  readonly cancellationReason?: string;
  readonly test: boolean;
  readonly objectHash: Uint8Array<ArrayBuffer>;
}

export interface YookassaRefund {
  readonly id: string;
  readonly paymentId: string;
  readonly status: "pending" | "succeeded" | "canceled";
  readonly amount: YookassaMoney;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly cancellationReason?: string;
  readonly objectHash: Uint8Array<ArrayBuffer>;
}

export interface CreateYookassaPayment {
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly description: string;
  readonly returnUrl?: string;
  readonly paymentMethodId?: string;
  readonly orderId: string;
  readonly workspaceId: string;
  readonly savePaymentMethod: boolean;
}

export interface CreateYookassaRefund {
  readonly idempotencyKey: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly description: string;
  readonly refundId: string;
}

export class YookassaProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number
  ) {
    super("YooKassa request failed");
    this.name = "YookassaProviderError";
  }
}

@Injectable()
export class YookassaClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public isEnabled(): boolean {
    return this.config.billing.yookassa.enabled;
  }

  public async createPayment(
    input: CreateYookassaPayment
  ): Promise<YookassaPayment> {
    this.assertIdempotencyKey(input.idempotencyKey);
    if (input.paymentMethodId) {
      assertProviderIdentifier(input.paymentMethodId, "paymentMethodId");
    } else if (!input.returnUrl) {
      throw new Error("Hosted YooKassa payment requires a return URL");
    }
    return parseYookassaPayment(
      await this.request("POST", "/payments", input.idempotencyKey, {
        amount: money(input.amountMinor),
        capture: true,
        ...(input.paymentMethodId
          ? { payment_method_id: input.paymentMethodId }
          : {
              confirmation: {
                type: "redirect",
                return_url: input.returnUrl
              },
              save_payment_method: input.savePaymentMethod
            }),
        description: input.description,
        metadata: {
          order_id: input.orderId,
          workspace_id: input.workspaceId
        }
      })
    );
  }

  public async getPayment(paymentId: string): Promise<YookassaPayment> {
    assertProviderIdentifier(paymentId, "paymentId");
    return parseYookassaPayment(
      await this.request(
        "GET",
        `/payments/${encodeURIComponent(paymentId)}`
      )
    );
  }

  public async createRefund(
    input: CreateYookassaRefund
  ): Promise<YookassaRefund> {
    this.assertIdempotencyKey(input.idempotencyKey);
    return parseYookassaRefund(
      await this.request("POST", "/refunds", input.idempotencyKey, {
        payment_id: input.paymentId,
        amount: money(input.amountMinor),
        description: input.description,
        metadata: { refund_id: input.refundId }
      })
    );
  }

  public async getRefund(refundId: string): Promise<YookassaRefund> {
    assertProviderIdentifier(refundId, "refundId");
    return parseYookassaRefund(
      await this.request("GET", `/refunds/${encodeURIComponent(refundId)}`)
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    idempotencyKey?: string,
    body?: Readonly<Record<string, unknown>>
  ): Promise<unknown> {
    const provider = this.config.billing.yookassa;
    if (
      !provider.enabled ||
      !provider.shopId ||
      !provider.secretKey
    ) {
      throw new YookassaProviderError("PAYMENT_PROVIDER_DISABLED", false);
    }
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(
        `${provider.shopId}:${provider.secretKey}`,
        "utf8"
      ).toString("base64")}`
    });
    if (body) headers.set("Content-Type", "application/json");
    if (idempotencyKey) {
      headers.set("Idempotence-Key", idempotencyKey);
    }

    const attempts = method === "GET" || idempotencyKey
      ? PROVIDER_NETWORK_ATTEMPTS
      : 1;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        response = await fetch(`${provider.apiBaseUrl}${path}`, {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(provider.requestTimeoutMs)
        });
        break;
      } catch {
        if (attempt === attempts) {
          throw new YookassaProviderError(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            true
          );
        }
      }
    }
    if (!response) {
      throw new YookassaProviderError("PAYMENT_PROVIDER_UNAVAILABLE", true);
    }

    const text = await boundedText(response);
    const payload = parseJson(text);
    if (!response.ok) {
      const code = providerErrorCode(payload, response.status);
      throw new YookassaProviderError(
        code,
        response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,
        response.status
      );
    }
    if (payload === undefined) {
      throw new YookassaProviderError(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        true,
        response.status
      );
    }
    return payload;
  }

  private assertIdempotencyKey(value: string): void {
    if (!/^[A-Za-z0-9_-]{8,64}$/u.test(value)) {
      throw new Error("Invalid YooKassa idempotency key");
    }
  }
}

export function parseYookassaPayment(value: unknown): YookassaPayment {
  const object = record(value);
  const id = providerIdentifier(object.id, "id");
  const status = paymentStatus(object.status);
  const paid = booleanValue(object.paid, "paid");
  const amount = moneyValue(object.amount);
  const createdAt = dateTimeValue(object.created_at, "created_at");
  const metadata = metadataValue(object.metadata);
  const capturedAt = optionalDateTime(object.captured_at, "captured_at");
  const confirmationUrl = confirmationUrlValue(object.confirmation);
  const paymentMethod = paymentMethodValue(object.payment_method);
  const cancellationReason = cancellationReasonValue(
    object.cancellation_details
  );
  const test = booleanValue(object.test, "test");
  return {
    id,
    status,
    paid,
    amount,
    createdAt,
    ...(capturedAt ? { capturedAt } : {}),
    ...(confirmationUrl ? { confirmationUrl } : {}),
    metadata,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(cancellationReason ? { cancellationReason } : {}),
    test,
    objectHash: objectHash(value)
  };
}

export function parseYookassaRefund(value: unknown): YookassaRefund {
  const object = record(value);
  const id = providerIdentifier(object.id, "id");
  const paymentId = providerIdentifier(object.payment_id, "payment_id");
  const status = refundStatus(object.status);
  const amount = moneyValue(object.amount);
  const createdAt = dateTimeValue(object.created_at, "created_at");
  const metadata = metadataValue(object.metadata);
  const cancellationReason = cancellationReasonValue(
    object.cancellation_details
  );
  return {
    id,
    paymentId,
    status,
    amount,
    createdAt,
    metadata,
    ...(cancellationReason ? { cancellationReason } : {}),
    objectHash: objectHash(value)
  };
}

function money(amountMinor: number): YookassaMoney {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Payment amount must be a positive safe integer");
  }
  return {
    value: `${Math.floor(amountMinor / 100)}.${String(
      amountMinor % 100
    ).padStart(2, "0")}`,
    currency: "RUB"
  };
}

export function yookassaMoneyMinor(value: YookassaMoney): number {
  if (value.currency !== "RUB" || !/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/u.test(value.value)) {
    throw invalidResponse();
  }
  const [major, minor] = value.value.split(".");
  const amount = Number(major) * 100 + Number(minor);
  if (!Number.isSafeInteger(amount) || amount < 0) throw invalidResponse();
  return amount;
}

async function boundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new YookassaProviderError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      true,
      response.status
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new YookassaProviderError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      true,
      response.status
    );
  }
  return text;
}

function parseJson(value: string): unknown {
  if (value === "") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function providerErrorCode(value: unknown, status: number): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    /^[a-z0-9_.-]{1,100}$/u.test(value.code)
  ) {
    return `YOOKASSA_${value.code.toUpperCase().replaceAll("-", "_")}`;
  }
  return `YOOKASSA_HTTP_${status}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function providerIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string") throw invalidResponse(path);
  assertProviderIdentifier(value, path);
  return value;
}

function assertProviderIdentifier(value: string, path: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw invalidResponse(path);
}

function paymentStatus(value: unknown): YookassaPayment["status"] {
  if (
    value !== "pending" &&
    value !== "waiting_for_capture" &&
    value !== "succeeded" &&
    value !== "canceled"
  ) {
    throw invalidResponse("status");
  }
  return value;
}

function refundStatus(value: unknown): YookassaRefund["status"] {
  if (
    value !== "pending" &&
    value !== "succeeded" &&
    value !== "canceled"
  ) {
    throw invalidResponse("status");
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw invalidResponse(path);
  return value;
}

function moneyValue(value: unknown): YookassaMoney {
  const object = record(value);
  if (
    typeof object.value !== "string" ||
    typeof object.currency !== "string"
  ) {
    throw invalidResponse("amount");
  }
  const result = { value: object.value, currency: object.currency };
  yookassaMoneyMinor(result);
  return result;
}

function dateTimeValue(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw invalidResponse(path);
  }
  return new Date(value).toISOString();
}

function optionalDateTime(
  value: unknown,
  path: string
): string | undefined {
  return value === undefined ? undefined : dateTimeValue(value, path);
}

function metadataValue(value: unknown): Readonly<Record<string, string>> {
  const object = record(value ?? {});
  const entries = Object.entries(object);
  if (entries.length > 32) throw invalidResponse("metadata");
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/u.test(key) ||
      typeof item !== "string" ||
      item.length > 512
    ) {
      throw invalidResponse("metadata");
    }
    result[key] = item;
  }
  return result;
}

function confirmationUrlValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const confirmation = record(value);
  if (
    confirmation.type !== "redirect" ||
    typeof confirmation.confirmation_url !== "string" ||
    confirmation.confirmation_url.length > 2_048
  ) {
    throw invalidResponse("confirmation");
  }
  let url: URL;
  try {
    url = new URL(confirmation.confirmation_url);
  } catch {
    throw invalidResponse("confirmation.confirmation_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw invalidResponse("confirmation.confirmation_url");
  }
  return url.toString();
}

function paymentMethodValue(
  value: unknown
): YookassaPaymentMethod | undefined {
  if (value === undefined) return undefined;
  const object = record(value);
  const type = providerIdentifier(object.type, "payment_method.type");
  const saved = booleanValue(object.saved, "payment_method.saved");
  const id =
    object.id === undefined
      ? undefined
      : providerIdentifier(object.id, "payment_method.id");
  const title =
    object.title === undefined
      ? undefined
      : safeString(object.title, "payment_method.title", 160);
  return {
    type,
    saved,
    ...(id ? { id } : {}),
    ...(title ? { title } : {})
  };
}

function cancellationReasonValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const object = record(value);
  return typeof object.reason === "string"
    ? safeString(object.reason, "cancellation_details.reason", 100)
    : undefined;
}

function safeString(value: unknown, path: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw invalidResponse(path);
  }
  return value;
}

function objectHash(value: unknown): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    createHash("sha256")
      .update(canonicalizeJson(value), "utf8")
      .digest()
  );
}

function invalidResponse(path?: string): Error {
  return new YookassaProviderError(
    path
      ? `PAYMENT_PROVIDER_INVALID_${path.toUpperCase().replaceAll(".", "_")}`
      : "PAYMENT_PROVIDER_INVALID_RESPONSE",
    true
  );
}
