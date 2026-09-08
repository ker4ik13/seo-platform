// Adapted from the owner's working neuroluv-server NPD client. All provider
// errors are finite codes; raw fiscal payloads and credentials never escape.
import type { InternalNpdIssueMaterial } from "@seo-platform/contracts";
const ORIGIN = "https://lknpd.nalog.ru/api/v1";
export class NpdRequestError extends Error {
  public constructor(public readonly code: string) { super(code); this.name = "NpdRequestError"; }
}
export class NpdClient {
  private session: { token: string; expiresAt: number } | undefined;
  public constructor(private readonly credentials: { inn: string; password: string; deviceId: string }) {
    if (!/^\d{12}$/u.test(credentials.inn) || !credentials.password || !/^[A-Za-z0-9_-]{8,128}$/u.test(credentials.deviceId)) throw new NpdRequestError("NPD_CONFIGURATION_INVALID");
  }
  public async prepare(): Promise<void> {
    if (this.session && this.session.expiresAt > Date.now() + 300_000) return;
    const response = await this.request("/auth/lkfl", {
      username: this.credentials.inn, password: this.credentials.password,
      deviceInfo: { appVersion: "1.0.0", sourceDeviceId: this.credentials.deviceId, sourceType: "WEB", metaDetails: { userAgent: "Mozilla/5.0" } }
    });
    const token = response.token;
    const expiresAt = Date.parse(String(response.tokenExpireIn));
    const profile = record(response.profile);
    if (typeof token !== "string" || !token || !Number.isFinite(expiresAt) || (profile.inn && profile.inn !== this.credentials.inn)) throw new NpdRequestError("NPD_AUTH_RESPONSE_INVALID");
    this.session = { token, expiresAt };
  }
  public async issue(input: InternalNpdIssueMaterial): Promise<{ officialReceiptId: string; officialReceiptUrl: string }> {
    if (!this.session || this.session.expiresAt <= Date.now() + 30_000) throw new NpdRequestError("NPD_SESSION_EXPIRED");
    const result = await this.request("/income", npdIncomeRequest(input), this.session.token);
    const reference = result.approvedReceiptUuid ?? record(result.incomeInfo).approvedReceiptUuid;
    if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{5,128}$/u.test(reference)) throw new NpdRequestError("NPD_ISSUE_OUTCOME_UNKNOWN");
    return { officialReceiptId: reference, officialReceiptUrl: `${ORIGIN}/receipt/${this.credentials.inn}/${encodeURIComponent(reference)}/print` };
  }
  private async request(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${ORIGIN}${path}`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch { throw new NpdRequestError(path === "/income" ? "NPD_ISSUE_OUTCOME_UNKNOWN" : "NPD_AUTH_UNAVAILABLE"); }
    const reader = response.body?.getReader();
    if (!reader) throw new NpdRequestError("NPD_EMPTY_RESPONSE");
    const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 131_072) { await reader.cancel(); throw new NpdRequestError("NPD_RESPONSE_TOO_LARGE"); } parts.push(part.value); }
    } finally { reader.releaseLock(); }
    if (!response.ok) { if (response.status === 401) this.session = undefined; throw new NpdRequestError(path === "/income" ? "NPD_ISSUE_REQUIRES_REVIEW" : "NPD_AUTH_FAILED"); }
    try { return record(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch { throw new NpdRequestError("NPD_RESPONSE_INVALID"); }
  }
}
export function npdIncomeRequest(input: InternalNpdIssueMaterial): Record<string, unknown> {
  if (!/^[1-9][0-9]{0,9}$/u.test(input.amountMinor)) throw new NpdRequestError("NPD_AMOUNT_INVALID");
  const amount = BigInt(input.amountMinor);
  const rubles = `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
  const business = input.buyerType !== "INDIVIDUAL";
  if (business && (!input.buyerInn || !/^\d{10}(?:\d{2})?$/u.test(input.buyerInn) || !input.buyerName)) throw new NpdRequestError("NPD_BUYER_INVALID");
  if (!input.description || input.description.length > 255) throw new NpdRequestError("NPD_DESCRIPTION_INVALID");
  return {
    operationTime: npdDate(input.paidAt), requestTime: npdDate(new Date().toISOString()),
    services: [{ name: input.description, amount: rubles, quantity: "1" }], totalAmount: rubles,
    client: { contactPhone: null, displayName: business ? input.buyerName : null, incomeType: business ? "FROM_LEGAL_ENTITY" : "FROM_INDIVIDUAL", inn: business ? input.buyerInn : null },
    paymentType: "CASH", ignoreMaxTotalIncomeRestriction: false
  };
}
export function npdDate(value: string): string {
  const date = Date.parse(value); if (!Number.isFinite(date)) throw new NpdRequestError("NPD_DATE_INVALID");
  return new Date(date + 3 * 3_600_000).toISOString().replace("Z", "+03:00");
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
