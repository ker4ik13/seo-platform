import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { CreateYookassaPayment, YookassaPayment } from "./yookassa.client.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class CryptoPayProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly providerReason?: string
  ) {
    super("Crypto Pay request failed"); this.name = "CryptoPayProviderError";
  }
}

@Injectable()
export class CryptoPayClient {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  public isEnabled(): boolean { return this.config.billing.cryptoPay?.enabled === true; }
  public async createPayment(input: CreateYookassaPayment): Promise<YookassaPayment> {
    if (input.paymentMethodId || input.savePaymentMethod) throw failure("RECURRING_UNSUPPORTED");
    if (!input.returnUrl || !UUID.test(input.orderId) || !UUID.test(input.workspaceId)) throw failure("INVALID_PAYMENT_SCOPE");
    const response = await this.call("createInvoice", {
      currency_type: "fiat", fiat: "RUB", amount: money(input.amountMinor),
      description: input.description.slice(0, 1024), expires_in: 3600,
      allow_anonymous: false, allow_comments: false,
      paid_btn_name: "callback", paid_btn_url: input.returnUrl,
      payload: JSON.stringify({ order_id: input.orderId, workspace_id: input.workspaceId })
    });
    return this.normalize(response);
  }
  public async getPayment(id: string): Promise<YookassaPayment> {
    if (!/^[1-9][0-9]{0,15}$/u.test(id)) throw failure("INVALID_INVOICE_ID");
    const response = object(await this.call("getInvoices", { invoice_ids: id }));
    const items = response.items;
    if (!Array.isArray(items) || items.length !== 1) throw failure("INVOICE_NOT_FOUND");
    const payment = this.normalize(items[0]);
    if (payment.id !== id) throw failure("INVOICE_ID_MISMATCH");
    return payment;
  }
  /** Recovery reads only. Crypto Pay has no createInvoice idempotency key. */
  public async findPayment(orderId: string, workspaceId: string): Promise<YookassaPayment | undefined> {
    const response = object(await this.call("getInvoices", { count: 1000 }));
    if (!Array.isArray(response.items) || response.items.length > 1000) throw failure("INVALID_INVOICE_LIST");
    const matches = response.items.filter(value => {
      try { const meta = metadata(object(value).payload); return meta.order_id === orderId && meta.workspace_id === workspaceId; } catch { return false; }
    });
    if (matches.length > 1) throw failure("AMBIGUOUS_INVOICE_RECOVERY");
    return matches.length === 1 ? this.normalize(matches[0]) : undefined;
  }
  public verifyWebhook(rawBody: Buffer, signature: string | undefined): { invoiceId: string; fingerprint: string; payloadHash: Buffer } {
    const token = this.config.billing.cryptoPay?.apiToken;
    if (!this.isEnabled() || !token || !signature || !verifyCryptoPaySignature(token, rawBody, signature)) throw failure("INVALID_WEBHOOK_SIGNATURE");
    let body: Record<string, unknown>;
    try { body = object(JSON.parse(rawBody.toString("utf8"))); } catch { throw failure("INVALID_WEBHOOK_BODY"); }
    if (body.update_type !== "invoice_paid") throw failure("UNSUPPORTED_WEBHOOK_EVENT");
    const date = Date.parse(String(body.request_date));
    if (!Number.isFinite(date) || date > Date.now() + 300_000 || date < Date.now() - 7 * 86_400_000) throw failure("WEBHOOK_DATE_OUT_OF_RANGE");
    const invoiceId = invoiceIdValue(object(body.payload).invoice_id);
    return { invoiceId, fingerprint: createHash("sha256").update(`crypto-pay:invoice_paid:${invoiceId}`).digest("hex"), payloadHash: createHash("sha256").update(rawBody).digest() };
  }
  private normalize(value: unknown): YookassaPayment {
    return normalizeCryptoPayInvoice(value, this.config.billing.cryptoPay?.apiBaseUrl.includes("testnet-") === true);
  }
  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const configuration = this.config.billing.cryptoPay;
    if (!this.isEnabled() || !configuration?.apiToken) throw failure("CRYPTO_PAY_DISABLED");
    let response: Response;
    try {
      response = await fetch(`${configuration.apiBaseUrl}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": configuration.apiToken },
        body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(configuration.requestTimeoutMs)
      });
    } catch { throw new CryptoPayProviderError("PROVIDER_OUTCOME_UNKNOWN", true); }
    const reader = response.body?.getReader();
    if (!reader) throw failure("EMPTY_PROVIDER_RESPONSE");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw failure("PROVIDER_RESPONSE_TOO_LARGE"); } chunks.push(item.value); }
    } finally { reader.releaseLock(); }
    let envelope: Record<string, unknown>;
    try { envelope = object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw failure("INVALID_PROVIDER_RESPONSE"); }
    if (!response.ok || envelope.ok !== true) {
      const providerReason = cryptoPayProviderReason(envelope.error);
      throw new CryptoPayProviderError(
        response.status === 429
          ? "PROVIDER_RATE_LIMIT"
          : providerReason
            ? `CRYPTO_PAY_${providerReason}`
            : `CRYPTO_PAY_HTTP_${response.status}`,
        response.status >= 500 || response.status === 429,
        response.status,
        providerReason
      );
    }
    return envelope.result;
  }
}
export function verifyCryptoPaySignature(token: string, rawBody: Buffer, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/iu.test(signature)) return false;
  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export function normalizeCryptoPayInvoice(value: unknown, test: boolean): YookassaPayment {
  const input = object(value);
  const id = invoiceIdValue(input.invoice_id);
  if (input.currency_type !== "fiat" || input.fiat !== "RUB") throw failure("INVOICE_CURRENCY_MISMATCH");
  const amount = cryptoPayAmount(input.amount);
  const status = input.status === "paid" ? "succeeded" : input.status === "active" ? "pending" : input.status === "expired" ? "canceled" : undefined;
  if (!status) throw failure("INVALID_INVOICE_STATUS");
  const createdAt = dateValue(input.created_at);
  const capturedAt = input.status === "paid" ? dateValue(input.paid_at) : undefined;
  const url = input.bot_invoice_url ?? input.mini_app_invoice_url ?? input.web_app_invoice_url ?? input.pay_url;
  const confirmationUrl = typeof url === "string" ? safeConfirmationUrl(url) : undefined;
  if (status === "pending" && !confirmationUrl) throw failure("INVOICE_URL_MISSING");
  return {
    id, status, paid: status === "succeeded", amount: { value: amount, currency: "RUB" }, createdAt,
    ...(capturedAt ? { capturedAt } : {}), ...(confirmationUrl ? { confirmationUrl } : {}),
    metadata: metadata(input.payload), test,
    ...(status === "canceled" ? { cancellationReason: "INVOICE_EXPIRED" } : {}),
    objectHash: createHash("sha256").update(canonicalizeJson(input)).digest()
  };
}
function safeConfirmationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw failure("INVALID_INVOICE_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["t.me", "pay.crypt.bot", "testnet-pay.crypt.bot"].includes(url.hostname)) throw failure("INVALID_INVOICE_URL");
  return url.toString();
}
function metadata(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "string" || value.length > 512) throw failure("INVALID_INVOICE_METADATA");
  let input: Record<string, unknown>;
  try { input = object(JSON.parse(value)); } catch { throw failure("INVALID_INVOICE_METADATA"); }
  if (Object.keys(input).sort().join(",") !== "order_id,workspace_id" || typeof input.order_id !== "string" || typeof input.workspace_id !== "string" || !UUID.test(input.order_id) || !UUID.test(input.workspace_id)) throw failure("INVALID_INVOICE_METADATA");
  return { order_id: input.order_id, workspace_id: input.workspace_id };
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_PROVIDER_OBJECT"); return value as Record<string, unknown>; }
function invoiceIdValue(value: unknown): string { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw failure("INVALID_INVOICE_ID"); return String(value); }
function dateValue(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw failure("INVALID_INVOICE_DATE"); return new Date(value).toISOString(); }
function failure(code: string): CryptoPayProviderError { return new CryptoPayProviderError(code, false); }
function money(value: number): string { if (!Number.isSafeInteger(value) || value < 1 || value > 100_000_000) throw failure("INVALID_PAYMENT_AMOUNT"); return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`; }
function cryptoPayAmount(value: unknown): string {
  const match = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/u.exec(String(value));
  if (!match?.[1]) throw failure("INVALID_INVOICE_AMOUNT");
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw failure("INVALID_INVOICE_AMOUNT");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
function cryptoPayProviderReason(value: unknown): string | undefined {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object" && !Array.isArray(value) &&
        "name" in value && typeof value.name === "string"
      ? value.name
      : undefined;
  return candidate && /^[A-Z][A-Z0-9_]{0,79}$/u.test(candidate)
    ? candidate
    : undefined;
}
