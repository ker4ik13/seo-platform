import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export interface PaidOperationClaimScope {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly leaseOwner: string;
  readonly jobVersion: number;
}
interface Ticket { id: string; token: string; state: string; quoteId: string; jobId: string; workspaceId: string; projectId: string; actorId: string; commandHash: string; unitsMilli: string; result: Record<string, unknown> | null; }
export class PaidOperationReviewError extends Error { public constructor() { super("PAID_OPERATION_REQUIRES_REVIEW"); this.name = "PaidOperationReviewError"; } }
export class PaidOperationUnavailableError extends Error { public constructor() { super("PAID_OPERATION_UNAVAILABLE"); this.name = "PaidOperationUnavailableError"; } }

@Injectable()
export class PaidOperationRuntimeService {
  // Only immutable classification is cached. Every paid send still obtains a
  // live Core authorization and starts a fenced SQL ticket.
  private readonly modes = new Map<string, { value: "BYOK_API_KEY" | "PLATFORM_PAID"; expiresAt: number }>();
  public constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async mode(scope: PaidOperationClaimScope): Promise<"BYOK_API_KEY" | "PLATFORM_PAID"> {
    const key = `${scope.workspaceId}:${scope.projectId}:${scope.jobId}`;
    const cached = this.modes.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const [row] = await this.prisma.$queryRaw<{ mode: string }[]>`SELECT public.read_provider_operation_mode(${scope.jobId}::uuid, ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${scope.leaseOwner}::text, ${scope.jobVersion}::integer) AS mode`;
    if (!row || (row.mode !== "BYOK_API_KEY" && row.mode !== "PLATFORM_PAID")) throw new PaidOperationUnavailableError();
    if (this.modes.size >= 2_000) this.modes.delete(this.modes.keys().next().value!);
    this.modes.set(key, { value: row.mode, expiresAt: Date.now() + 600_000 });
    return row.mode;
  }

  public async execute<T extends object>(scope: PaidOperationClaimScope, part: string, items: readonly string[], network: () => Promise<T>, normalize: (result: T) => T = result => result): Promise<T> {
    if (await this.mode(scope) === "BYOK_API_KEY") return network();
    const ticket = await this.prepare(scope, part, items);
    if (ticket.state === "ACCEPTED" && ticket.result) return ticket.result as T;
    if (ticket.state !== "PREPARED") throw new PaidOperationReviewError();
    await this.authorize(ticket);
    const [started] = await this.prisma.$queryRaw<{ started: boolean }[]>`SELECT public.start_provider_usage_ticket(${ticket.id}::uuid, ${ticket.token}::uuid) AS started`;
    if (started?.started !== true) throw new PaidOperationUnavailableError();
    let result: T;
    try { result = normalize(await network()); }
    catch { await this.finish(ticket, "UNKNOWN", null).catch(() => {}); throw new PaidOperationReviewError(); }
    const state = outcomeState(result);
    try {
      // Retry durable evidence only, never the paid network operation.
      for (let attempt = 0; ; attempt++) {
        try { await this.finish(ticket, state, state === "ACCEPTED" ? result : null); break; }
        catch (error) { if (attempt >= 2) throw error; }
      }
    } catch { throw new PaidOperationReviewError(); }
    if (state === "UNKNOWN") throw new PaidOperationReviewError();
    return result;
  }

  public async acceptedTaskId(
    scope: PaidOperationClaimScope,
    items: readonly string[],
    part = "TASK"
  ): Promise<string | undefined> {
    if (await this.mode(scope) === "BYOK_API_KEY") return undefined;
    const ticket = await this.prepare(scope, part, items);
    const taskId = ticket.result?.taskId;
    return ticket.state === "ACCEPTED" && ticket.result?.status === "ACCEPTED" && typeof taskId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(taskId) ? taskId : undefined;
  }

  private async prepare(scope: PaidOperationClaimScope, part: string, items: readonly string[]): Promise<Ticket> {
    const [row] = await this.prisma.$queryRaw<{ ticket: unknown }[]>(Prisma.sql`SELECT public.prepare_provider_usage_ticket(${scope.jobId}::uuid, ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${scope.leaseOwner}::text, ${scope.jobVersion}::integer, ${part}::text, ${[...items]}::uuid[]) AS ticket`);
    return parseTicket(row?.ticket, scope);
  }

  private async finish(ticket: Ticket, state: "ACCEPTED" | "REJECTED" | "UNKNOWN", result: object | null): Promise<void> {
    const json = result === null ? null : JSON.stringify(result);
    const [row] = await this.prisma.$queryRaw<{ completed: boolean }[]>`SELECT public.finish_provider_usage_ticket(${ticket.id}::uuid, ${ticket.token}::uuid, ${state}::text, ${json}::jsonb) AS completed`;
    if (row?.completed !== true) throw new PaidOperationReviewError();
  }

  private async authorize(ticket: Ticket): Promise<void> {
    const token = this.config.rankBillingSettlementApiToken;
    if (!token) throw new PaidOperationUnavailableError();
    try {
      const response = await fetch(new URL(`/internal/v1/billing/operations/${ticket.quoteId}/authorize`, this.config.services.platformApi), { method: "POST", headers: { "Content-Type": "application/json", "X-Rank-Billing-Settlement-Token": token, "X-Request-Id": `operation-${ticket.id}` }, body: JSON.stringify({ ticketId: ticket.id, ticketToken: ticket.token }), redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { await response.body?.cancel(); throw new PaidOperationUnavailableError(); }
      const reader = response.body?.getReader(); if (!reader) throw new PaidOperationUnavailableError();
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 4096) { await reader.cancel(); throw new PaidOperationUnavailableError(); } chunks.push(item.value); } } finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { data?: { permitted?: boolean } };
      if (value.data?.permitted !== true) throw new PaidOperationUnavailableError();
    } catch { throw new PaidOperationUnavailableError(); }
  }
}

export function outcomeState(value: object): "ACCEPTED" | "REJECTED" | "UNKNOWN" {
  const result = value as Record<string, unknown>;
  if (result.ok === true || (result.status === "ACCEPTED" && typeof result.taskId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(result.taskId))) return "ACCEPTED";
  // Only explicit non-chargeable rejection is safe to resubmit. An HTTP
  // timeout/invalid payload/5xx may follow a successful provider charge.
  if (["PROVIDER_RATE_LIMITED", "PROVIDER_CONCURRENCY_LIMITED", "INVALID_CREDENTIAL", "PROVIDER_AUTH_FAILED", "PROVIDER_REQUEST_REJECTED", "PROVIDER_INSUFFICIENT_BALANCE", "PROVIDER_QUOTA_EXCEEDED"].includes(String(result.code))) return "REJECTED";
  return "UNKNOWN";
}
function parseTicket(value: unknown, scope: PaidOperationClaimScope): Ticket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaidOperationUnavailableError();
  const input = value as Record<string, unknown>;
  if (input.mode !== "PLATFORM_PAID" || input.jobId !== scope.jobId || input.workspaceId !== scope.workspaceId || input.projectId !== scope.projectId || !["PREPARED", "STARTED", "ACCEPTED", "REJECTED", "UNKNOWN"].includes(String(input.state))) throw new PaidOperationUnavailableError();
  for (const key of ["id", "token", "quoteId", "actorId"]) if (typeof input[key] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input[key])) throw new PaidOperationUnavailableError();
  if (typeof input.commandHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.commandHash) || typeof input.unitsMilli !== "string" || !/^[1-9][0-9]{0,12}$/u.test(input.unitsMilli) || input.result !== null && (!input.result || typeof input.result !== "object" || Array.isArray(input.result))) throw new PaidOperationUnavailableError();
  return input as unknown as Ticket;
}
