import { BadRequestException, ConflictException } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { InternalPaidOperationAdmission, PaidOperationKind } from "@seo-platform/contracts";
import type { ResolvedConnectorRoute } from "../integrations/workspace-connector-routing.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function paidOperationAdmissionInput(value: unknown): { billing?: InternalPaidOperationAdmission } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const fields = ["quoteId", "jobId", "provider", "credentialId", "bindingId", "bindingVersion", "routeId", "commandHash", "maximumProviderUnitsMilli", "createBefore"];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) throw invalid();
  for (const key of ["quoteId", "jobId", "credentialId", "bindingId", "routeId"]) if (typeof input[key] !== "string" || !UUID.test(input[key])) throw invalid();
  if (!Number.isSafeInteger(input.bindingVersion) || Number(input.bindingVersion) < 1 || !["XMLSTOCK", "ARSENKIN"].includes(String(input.provider)) || typeof input.commandHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.commandHash) || typeof input.maximumProviderUnitsMilli !== "string" || !/^[1-9][0-9]{0,12}$/u.test(input.maximumProviderUnitsMilli) || typeof input.createBefore !== "string" || !Number.isFinite(Date.parse(input.createBefore))) throw invalid();
  return { billing: input as unknown as InternalPaidOperationAdmission };
}

export function paidOperationJobFields(kind: PaidOperationKind, input: { workspaceId: string; projectId: string; actorId: string; billing?: InternalPaidOperationAdmission }, route: ResolvedConnectorRoute): { id?: string; billingQuoteId?: string; billingCommandHash?: Uint8Array<ArrayBuffer>; billingMaximumUnitsMilli?: bigint } {
  if (route.credentialMode === "BYOK_API_KEY") {
    if (input.billing) throw conflict();
    return {};
  }
  const billing = input.billing;
  if (route.credentialMode !== "PLATFORM_PAID" || !billing) throw conflict();
  if (billing.provider !== route.provider || billing.credentialId !== route.credentialId || billing.bindingId !== route.bindingId || billing.bindingVersion !== route.bindingVersion || billing.routeId !== route.routeId || Date.parse(billing.createBefore) <= Date.now()) throw conflict();
  const command = Object.fromEntries(Object.entries(input).filter(([key]) => !["workspaceId", "projectId", "actorId", "idempotencyKey", "correlationId", "jobCapacity", "billing"].includes(key)));
  const actual = canonicalJsonSha256("paid-operation-command@1", { workspaceId: input.workspaceId, projectId: input.projectId, actorId: input.actorId, kind, command });
  if (actual !== billing.commandHash) throw conflict();
  return { id: billing.jobId, billingQuoteId: billing.quoteId, billingCommandHash: Uint8Array.from(Buffer.from(billing.commandHash, "hex")), billingMaximumUnitsMilli: BigInt(billing.maximumProviderUnitsMilli) };
}
function invalid() { return new BadRequestException("Invalid funded operation admission"); }
function conflict() { return new ConflictException({ code: "ESTIMATE_STALE", message: "Confirm the current operation price before using a system API key" }); }
