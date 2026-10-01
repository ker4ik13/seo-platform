import type { RemoteRankPollTaskV1 } from "@seo-platform/contracts";
import { rankProviderRequestIntent } from "../rank-runs/rank-provider-request-intent.js";
import { xmlStockRankPageProgress } from "../rank-runs/xmlstock-rank.connector.js";

export function parseWorkerRankTask(value: unknown): RemoteRankPollTaskV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  const fields = ["schemaVersion", "ticket", "provider", "providerTaskId", "requestSnapshot", "secret", "timeoutMs",
    ...(Object.hasOwn(input, "providerProgress") ? ["providerProgress"] : []),...(Object.hasOwn(input, "softId") ? ["softId"] : [])];
  const secret = input.secret;
  const secretRecord = typeof secret === "object" && secret !== null && !Array.isArray(secret) ? secret as Record<string, unknown> : undefined;
  const secretFields = secretRecord ? ["apiKey", ...(Object.hasOwn(secretRecord, "accountIdentifier") ? ["accountIdentifier"] : [])] : [];
  if (Object.keys(input).length !== fields.length || fields.some((field) => !Object.hasOwn(input, field)) ||
    input.schemaVersion !== "worker-rank-poll-task@1" || input.provider !== "XMLSTOCK" ||
    typeof input.ticket !== "string" || input.ticket.length > 4096 || !/^wrt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(input.ticket) ||
    typeof input.providerTaskId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.providerTaskId) ||
    typeof input.timeoutMs !== "number" || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 10_000 ||
    (input.softId !== undefined && (typeof input.softId !== "string" || !/^[a-f0-9]{32}$/iu.test(input.softId))) ||
    !secretRecord || Object.keys(secretRecord).length !== secretFields.length || typeof secretRecord.apiKey !== "string" || secretRecord.apiKey.length < 1 || secretRecord.apiKey.length > 512 ||
    (secretRecord.accountIdentifier !== undefined && (typeof secretRecord.accountIdentifier !== "string" || secretRecord.accountIdentifier.length < 1 || secretRecord.accountIdentifier.length > 512))) invalid();
  rankProviderRequestIntent(input.requestSnapshot);if(input.providerProgress!==undefined) xmlStockRankPageProgress(input.providerProgress);
  return input as unknown as RemoteRankPollTaskV1;
}
function invalid():never {throw new TypeError("Invalid worker rank task");}
