import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AdminPaidUsageReview, ResolvePaidUsageInput } from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { OperationBillingService } from "../billing/operation-billing.service.js";
import { BillingUsageService } from "../billing/billing-usage.service.js";
import { apiResponse } from "../common/api-response.js";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { inputObject, stringField } from "../common/input.js";
import { PrismaService } from "../database/prisma.service.js";
import type { BillingOperationQuote, BillingUsageReservation } from "../generated/prisma/client.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard, SessionAuthGuard, headerValue } from "../identity/session-auth.guard.js";
import { JobsClient, type InternalContext } from "../jobs/jobs.client.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";

@Controller("admin-api/v1/usage-reviews")
@RequirePlatformRole("FINANCE")
export class PlatformUsageReviewController {
  public constructor(private readonly prisma: PrismaService, private readonly jobs: JobsClient, private readonly billing: OperationBillingService, private readonly audit: AuditService, private readonly rankUsage: BillingUsageService) {}

  @Get() @UseGuards(SessionAuthGuard, PlatformRoleGuard)
  public async list(@Req() request: PlatformAdminRequest) {
    const quotes = await this.prisma.billingOperationQuote.findMany({ where: { status: "REVIEW" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 25 });
    const ranks = await this.prisma.billingUsageReservation.findMany({ where: { status: "RESERVED", providerStartedAt: { not: null }, expiresAt: { lt: new Date(Date.now() - 300_000) } }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 25 });
    const workspaces = await this.prisma.workspace.findMany({ where: { id: { in: [...new Set([...quotes, ...ranks].map(quote => quote.workspaceId))] } }, select: { id: true, name: true } });
    const names = new Map(workspaces.map(workspace => [workspace.id, workspace.name]));
    const data: AdminPaidUsageReview[] = [];
    for (let offset = 0; offset < quotes.length; offset += 4) {
      data.push(...await Promise.all(quotes.slice(offset, offset + 4).filter(quote => quote.jobId).map(async quote => {
        const details = await this.jobs.paidOperationReview(context(quote, request.id), scope(quote));
        return { quoteId: quote.id, jobId: quote.jobId!, workspaceId: quote.workspaceId, workspaceName: names.get(quote.workspaceId) ?? "—", projectId: quote.projectId,
          kind: quote.kind as AdminPaidUsageReview["kind"], provider: quote.provider as AdminPaidUsageReview["provider"], maximumChargeMinor: Number(quote.maximumChargeMinor), capturedMinor: Number(quote.capturedMinor), reservedMinor: Number(quote.maximumChargeMinor - quote.capturedMinor - quote.releasedMinor), createdAt: quote.createdAt.toISOString(), terminal: details.terminal, tickets: details.tickets };
      })));
    }
    for (let offset = 0; offset < ranks.length; offset += 4) {
      data.push(...await Promise.all(ranks.slice(offset, offset + 4).map(async rank => {
        const job = await this.jobs.getRankJob(context(rank, request.id), rank.jobId);
        const eligibleAt = rankReviewEligibleAt(rank, job.finishedAt);
        return { quoteId: rank.id, jobId: rank.jobId, workspaceId: rank.workspaceId, workspaceName: names.get(rank.workspaceId) ?? "—", projectId: rank.projectId, kind: "RANK" as const, provider: job.provider, maximumChargeMinor: Number(rank.amountMinor), capturedMinor: 0, reservedMinor: Number(rank.amountMinor), createdAt: rank.createdAt.toISOString(), terminal: Boolean(job.finishedAt), tickets: [{ id: rank.id, part: rank.jobItemId, unitsMilli: "1000", startedAt: rank.providerStartedAt!.toISOString(), finishedAt: job.finishedAt ?? null, resolution: null, resolvedAt: null, resolutionReason: null, providerReference: null, eligibleAt: eligibleAt.toISOString() }] };
      })));
    }
    return apiResponse(request, data);
  }

  @Post("rank/:reservationId/resolve") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async resolveRank(@Param("reservationId") reservationId: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const id = assertUuid(reservationId, "reservationId"), input = parseUsageReviewDecision(body);
    const key = requiredIdempotencyKey(headerValue(request, "idempotency-key"));
    const decision = { ...input, providerReference: input.providerReference ?? null, actorId: principal.userId, idempotencyKey: key };
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM billing_usage_reservations WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.billingUsageReservation.findUnique({ where: { id } });
      if (!row || !row.providerStartedAt) throw new DomainError({ statusCode: 404, code: "NOT_FOUND", message: "Provider reservation not found" });
      if (row.reviewDecision) {
        const stored = row.reviewDecision as Record<string, unknown>;
        if (Object.entries(decision).some(([field, value]) => stored[field] !== value)) throw new ConflictException("The financial decision is already final");
        return { reservationId: row.id, status: row.status };
      }
      if (row.status !== "RESERVED") throw new ConflictException("The provider reservation is already settled");
      const job = await this.jobs.getRankJob(context(row, request.id), row.jobId);
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      if (!clock || !job.finishedAt || rankReviewEligibleAt(row, job.finishedAt) > clock.now) throw new ConflictException("Wait for the operation and its provider lease to end");
      const stored = { ...decision, resolvedAt: clock.now.toISOString() };
      const settled = input.resolution === "CHARGE" ? await this.rankUsage.capture(tx, row.id, stored) : await this.rankUsage.release(tx, row.id, stored);
      await this.audit.record({ actorId: principal.userId, workspaceId: row.workspaceId, projectId: row.projectId, action: "billing.rank_usage_review.resolved", resourceType: "billing_usage_reservation", resourceId: row.id, reason: input.reason, redactedChanges: { resolution: input.resolution }, requestId: request.id }, tx);
      return { reservationId: row.id, status: settled.status };
    }, { timeout: 20_000 });
    return apiResponse(request, result);
  }

  @Post(":quoteId/tickets/:ticketId/resolve") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async resolve(@Param("quoteId") quoteId: string, @Param("ticketId") ticketId: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = parseUsageReviewDecision(body);
    const quote = await this.prisma.billingOperationQuote.findUnique({ where: { id: assertUuid(quoteId, "quoteId") } });
    if (!quote || !quote.jobId) throw new DomainError({ statusCode: 404, code: "NOT_FOUND", message: "Operation quote not found" });
    const id = assertUuid(ticketId, "ticketId"), key = requiredIdempotencyKey(headerValue(request, "idempotency-key"));
    await this.audit.record({ actorId: principal.userId, workspaceId: quote.workspaceId, projectId: quote.projectId, action: "billing.usage_review.requested", resourceType: "provider_usage_ticket", resourceId: id, outcome: "REQUESTED", requestId: request.id });
    const result = await this.jobs.resolvePaidOperationReview(context(quote, request.id), scope(quote), id, input, principal.userId, key);
    await this.audit.record({ actorId: principal.userId, workspaceId: quote.workspaceId, projectId: quote.projectId, action: "billing.usage_review.resolved", resourceType: "provider_usage_ticket", resourceId: id, requestId: request.id });
    // Jobs owns the immutable decision. Normal reconciliation remains able to
    // finish the ledger even if this immediate refresh is interrupted.
    await this.billing.reconcileOne(quote);
    return apiResponse(request, result);
  }
}
function scope(quote: BillingOperationQuote) { return { quoteId: quote.id, jobId: quote.jobId!, commandHash: Buffer.from(quote.commandHash).toString("hex") }; }
function context(quote: Pick<BillingOperationQuote, "workspaceId" | "projectId" | "actorId">, requestId: string): InternalContext { return { tenant: { workspaceId: quote.workspaceId, projectId: quote.projectId, workspaceStatus: "ACTIVE", projectStatus: "ACTIVE", roleCode: "OWNER" }, actorId: quote.actorId, requestId }; }
function rankReviewEligibleAt(row: BillingUsageReservation, finishedAt?: string): Date { return new Date(Math.max(row.expiresAt.getTime(), row.providerStartedAt!.getTime(), finishedAt ? Date.parse(finishedAt) : 0) + 300_000); }

export function parseUsageReviewDecision(body: unknown): ResolvePaidUsageInput {
    const raw = inputObject(body);
    if (Object.keys(raw).some(key => !["resolution", "reason", "providerReference", "confirmed"].includes(key)) || raw.confirmed !== true || (raw.resolution !== "CHARGE" && raw.resolution !== "RELEASE")) throw new BadRequestException("Confirm the provider usage decision");
    const reference = raw.providerReference === undefined ? undefined : stringField(raw, "providerReference", { min: 5, max: 128 });
    if (raw.resolution === "CHARGE" && !reference || reference !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$/u.test(reference)) throw new BadRequestException("Enter a provider operation reference without URLs or API keys");
    const input: ResolvePaidUsageInput = { resolution: raw.resolution, reason: stringField(raw, "reason", { min: 5, max: 500 }), ...(reference ? { providerReference: reference } : {}) };
    return input;
}
