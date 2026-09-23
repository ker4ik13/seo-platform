import { Body, Controller, Post, Req, UseGuards, BadRequestException, ConflictException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { InternalOperationRoute, InternalPaidOperationProof, InternalPaidOperationUsage, IntegrationCapability, IntegrationProvider, PaidOperationKind } from "@seo-platform/contracts";
import {
  frequencyCollectionKeywordLimit,
  paidOperationKinds,
  semanticFrequencyTypes
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import type { InternalPaidUsageReview, PaidUsageReviewTicket } from "@seo-platform/contracts";
import type { ProviderUsageTicket } from "../generated/prisma/client.js";

const reviewDelayMs = 5 * 60_000;
const terminalStates = ["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED_FINAL", "ACTION_REQUIRED"];
const maxXmlStockRequestCount =
  frequencyCollectionKeywordLimit * semanticFrequencyTypes.length;

@Controller("internal/v1/paid-operations")
export class PaidOperationController {
  public constructor(private readonly prisma: PrismaService, private readonly routing: WorkspaceConnectorRoutingService) {}

  @Post("route") @UseGuards(IntegrationCredentialApiGuard)
  public async route(@Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(request);
    const input = record(body, [
      "kind",
      "source",
      "provider",
      "credentialId",
      "xmlStockRequestCount"
    ]);
    if (!paidOperationKinds.includes(input.kind as PaidOperationKind)) throw invalid();
    const kind = input.kind as PaidOperationKind;
    const capability: IntegrationCapability = kind === "FREQUENCY_COLLECTION" ? "WORDSTAT" : kind === "AI_ANSWER_COLLECTION" ? "SERP_COLLECTION" : kind === "CLUSTERING_RUN" ? "CLUSTERING" : input.source === "KEYS_SO" ? "COMPETITOR_RESEARCH" : "KEYWORD_RESEARCH";
    if (kind === "KEYWORD_RESEARCH" && !["KEYS_SO", "ARSENKIN_WORDSTAT", "XMLSTOCK_WORDSTAT"].includes(String(input.source))) throw invalid();
    if (
      kind !== "FREQUENCY_COLLECTION" && input.provider !== undefined
    ) throw invalid();
    if (
      kind === "FREQUENCY_COLLECTION" &&
      (input.provider === undefined) !== (input.credentialId === undefined)
    ) throw invalid();
    const provider: IntegrationProvider | undefined = kind === "FREQUENCY_COLLECTION"
      ? providerValue(input.provider)
      : kind === "KEYWORD_RESEARCH"
        ? input.source === "KEYS_SO" ? "KEYS_SO" : input.source === "XMLSTOCK_WORDSTAT" ? "XMLSTOCK" : "ARSENKIN"
        : "ARSENKIN";
    const credentialId = input.credentialId !== undefined
      ? internalUuid(String(input.credentialId), "credentialId")
      : undefined;
    const rawXmlStockRequestCount = input.xmlStockRequestCount;
    const xmlStockRequirementAllowed = kind === "FREQUENCY_COLLECTION" ||
      kind === "KEYWORD_RESEARCH" && input.source === "XMLSTOCK_WORDSTAT";
    if (
      rawXmlStockRequestCount !== undefined && (
        !xmlStockRequirementAllowed ||
        typeof rawXmlStockRequestCount !== "number" ||
        !Number.isSafeInteger(rawXmlStockRequestCount) ||
        rawXmlStockRequestCount < 1 ||
        rawXmlStockRequestCount > maxXmlStockRequestCount
      )
    ) throw invalid();
    const xmlStockRequestCount = rawXmlStockRequestCount as number | undefined;
    const route = await this.routing.resolve(
      context.workspaceId,
      context.projectId,
      capability,
      context.actorId,
      provider,
      credentialId,
      {
        ...(kind === "FREQUENCY_COLLECTION" || provider === undefined
          ? {}
          : { allowedProviders: [provider] }),
        ...(xmlStockRequestCount === undefined
          ? {}
          : {
              xmlStock: {
                product: "WORDSTAT" as const,
                requestCount: xmlStockRequestCount
              }
            })
      }
    );
    if (!["ARSENKIN", "XMLSTOCK", "KEYS_SO"].includes(route.provider) || !["BYOK_API_KEY", "PLATFORM_PAID"].includes(route.credentialMode)) throw invalid();
    const data: InternalOperationRoute = { ...context, provider: route.provider as InternalOperationRoute["provider"], credentialMode: route.credentialMode as InternalOperationRoute["credentialMode"], credentialId: route.credentialId, bindingId: route.bindingId, bindingVersion: route.bindingVersion, routeId: route.routeId };
    return { data, meta: { requestId: request.id } };
  }

  @Post("usage") @UseGuards(PlatformApiGuard)
  public async usage(@Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(request);
    const input = usageScope(body);
    const data = await this.prisma.$transaction(async tx => {
      const job = await tx.job.findUnique({ where: { id: input.jobId } });
      if (!job) return { ...context, ...input, exists: false, terminal: true, acceptedProviderUnitsMilli: "0", unresolvedProviderUnitsMilli: "0", lastUpdatedAt: new Date().toISOString() } satisfies InternalPaidOperationUsage;
      assertJob(job, context, input);
      const terminal = terminalStates.includes(job.status)
        // Wordstat collection is finished even if importing its result is not.
        || (job.type === "KEYWORD_RESEARCH" && Boolean(await tx.keywordResearchRun.findFirst({ where: { jobId: job.id, status: { in: ["READY_TO_IMPORT", "IMPORT_QUEUED", "IMPORTING", "COMPLETED", "CANCELLED", "FAILED"] } }, select: { id: true } })));
      const groups = await tx.providerUsageTicket.groupBy({ by: ["state", "resolution"], where: { jobId: job.id }, _sum: { unitsMilli: true }, _max: { updatedAt: true } });
      const accepted = groups.filter(group => group.state === "ACCEPTED" || group.resolution === "CHARGE").reduce((sum, group) => sum + (group._sum.unitsMilli ?? 0n), 0n);
      const unresolved = groups.filter(group => !group.resolution && ["STARTED", "UNKNOWN", ...(terminal ? [] : ["PREPARED"])].includes(group.state)).reduce((sum, group) => sum + (group._sum.unitsMilli ?? 0n), 0n);
      return { ...context, ...input, exists: true, terminal, acceptedProviderUnitsMilli: accepted.toString(), unresolvedProviderUnitsMilli: unresolved.toString(), lastUpdatedAt: new Date(Math.max(job.updatedAt.getTime(), ...groups.map(group => group._max.updatedAt?.getTime() ?? 0))).toISOString() } satisfies InternalPaidOperationUsage;
    }, { isolationLevel: "RepeatableRead" });
    return { data, meta: { requestId: request.id } };
  }

  @Post("review") @UseGuards(PlatformApiGuard)
  public async review(@Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(request), input = usageScope(body);
    const job = await this.prisma.job.findUnique({ where: { id: input.jobId } });
    if (!job) throw invalid();
    assertJob(job, context, input);
    const tickets = await this.prisma.providerUsageTicket.findMany({ where: { jobId: job.id, state: { in: ["STARTED", "UNKNOWN"] } }, orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }], take: 100 });
    const data: InternalPaidUsageReview = { ...context, ...input, terminal: terminalStates.includes(job.status) && (!job.leaseExpiresAt || job.leaseExpiresAt <= new Date()), tickets: tickets.map(reviewTicket) };
    return { data, meta: { requestId: request.id } };
  }

  @Post("resolve-review") @UseGuards(PlatformApiGuard)
  public async resolveReview(@Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(request);
    const raw = record(body, ["quoteId", "jobId", "commandHash", "ticketId", "resolution", "reason", "providerReference", "resolutionKey", "decidedBy"]);
    const input = usageScope({ quoteId: raw.quoteId, jobId: raw.jobId, commandHash: raw.commandHash });
    const ticketId = internalUuid(String(raw.ticketId), "ticketId"), decidedBy = internalUuid(String(raw.decidedBy), "decidedBy");
    const resolution = raw.resolution, reason = typeof raw.reason === "string" ? raw.reason.trim() : "", reference = raw.providerReference ?? null;
    if ((resolution !== "CHARGE" && resolution !== "RELEASE") || reason.length < 5 || reason.length > 500 || typeof raw.resolutionKey !== "string" || !/^[A-Za-z0-9._:-]{8,180}$/u.test(raw.resolutionKey) || reference !== null && (typeof reference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$/u.test(reference)) || resolution === "CHARGE" && reference === null) throw invalid();
    const resolutionKey = raw.resolutionKey;
    const data = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`;
      const job = await tx.job.findUnique({ where: { id: input.jobId } });
      if (!job) throw invalid(); assertJob(job, context, input);
      await tx.$queryRaw`SELECT id FROM provider_usage_tickets WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const ticket = await tx.providerUsageTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.jobId !== job.id) throw invalid();
      if (ticket.resolvedAt) {
        if (ticket.resolution !== resolution || ticket.resolvedBy !== decidedBy || ticket.resolutionReason !== reason || ticket.providerReference !== reference || ticket.resolutionKey !== resolutionKey) throw new ConflictException("Provider usage already has a different final decision");
        return reviewTicket(ticket);
      }
      if (!terminalStates.includes(job.status) || job.leaseExpiresAt && job.leaseExpiresAt > new Date() || !["STARTED", "UNKNOWN"].includes(ticket.state) || !ticket.startedAt || Date.parse(reviewTicket(ticket).eligibleAt) > Date.now()) throw new ConflictException("Wait until execution has ended and the provider result can be verified");
      return reviewTicket(await tx.providerUsageTicket.update({ where: { id: ticket.id }, data: { state: "UNKNOWN", resolution, resolvedBy: decidedBy, resolvedAt: new Date(), resolutionReason: reason, providerReference: reference as string | null, resolutionKey, finishedAt: ticket.finishedAt ?? new Date() } }));
    });
    return { data, meta: { requestId: request.id } };
  }

  @Post("proof") @UseGuards(PlatformApiGuard)
  public async proof(@Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(request);
    const raw = record(body, ["quoteId", "jobId", "commandHash", "ticketId", "ticketToken"]);
    const input = usageScope({ quoteId: raw.quoteId, jobId: raw.jobId, commandHash: raw.commandHash });
    const ticketId = internalUuid(String(raw.ticketId), "ticketId");
    const ticketToken = internalUuid(String(raw.ticketToken), "ticketToken");
    const job = await this.prisma.job.findUnique({ where: { id: input.jobId } });
    if (!job) throw invalid();
    assertJob(job, context, input);
    const ticket = await this.prisma.providerUsageTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.jobId !== job.id || ticket.ticketToken !== ticketToken) throw invalid();
    const permitted = ticket.state === "PREPARED" && job.status === "RUNNING" && !job.cancelRequestedAt && job.version === ticket.jobVersion && job.leaseOwner === ticket.leaseOwner && Boolean(job.leaseExpiresAt && job.leaseExpiresAt > new Date());
    const data: InternalPaidOperationProof = { ...context, ...input, ticketId, ticketToken, permitted, leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? new Date(0).toISOString(), unitsMilli: ticket.unitsMilli.toString() };
    return { data, meta: { requestId: request.id } };
  }

  @Post("authorize") @UseGuards(PlatformApiGuard)
  public async authorize(@Body() body: unknown, @Req() request: FastifyRequest) {
    const { data: proof } = await this.proof(body, request);
    if (!proof.permitted) throw new ConflictException("Provider ticket cannot be authorized");
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${proof.jobId}::uuid FOR UPDATE`;
      const changed = await tx.$executeRaw`
        UPDATE provider_usage_tickets t SET authorized_at = clock_timestamp(), updated_at = clock_timestamp()
        FROM jobs j WHERE t.id = ${proof.ticketId}::uuid AND t.ticket_token = ${proof.ticketToken}::uuid AND t.state = 'PREPARED'
          AND j.id = t.job_id AND j.id = ${proof.jobId}::uuid AND j.billing_quote_id = ${proof.quoteId}::uuid
          AND j.status = 'RUNNING' AND j.cancel_requested_at IS NULL AND j.version = t.job_version
          AND j.lease_owner = t.lease_owner AND j.lease_expires_at > clock_timestamp() + interval '1 second'
      `;
      if (changed !== 1) throw new ConflictException("Provider ticket lease changed");
    });
    return { data: { permitted: true }, meta: { requestId: request.id } };
  }
}
function scope(request: FastifyRequest) { const context = internalCommandContext(request.headers); return { workspaceId: internalUuid(context.workspaceId, "workspaceId"), projectId: internalUuid(context.projectId, "projectId"), actorId: internalUuid(context.actorId, "actorId") }; }
function providerValue(value: unknown): IntegrationProvider | undefined { if (value === undefined) return undefined; if (value === "XMLSTOCK" || value === "ARSENKIN") return value; throw invalid(); }
function usageScope(body: unknown) { const input = record(body, ["quoteId", "jobId", "commandHash"]); if (typeof input.commandHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.commandHash)) throw invalid(); return { quoteId: internalUuid(String(input.quoteId), "quoteId"), jobId: internalUuid(String(input.jobId), "jobId"), commandHash: input.commandHash }; }
function assertJob(job: { workspaceId: string; projectId: string | null; actorId: string | null; billingQuoteId: string | null; billingCommandHash: Uint8Array | null }, context: ReturnType<typeof scope>, input: ReturnType<typeof usageScope>) { if (job.workspaceId !== context.workspaceId || job.projectId !== context.projectId || job.actorId !== context.actorId || job.billingQuoteId !== input.quoteId || !job.billingCommandHash || Buffer.from(job.billingCommandHash).toString("hex") !== input.commandHash) throw new ConflictException("Paid operation scope does not match"); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw invalid(); return value as Record<string, unknown>; }
function invalid() { return new BadRequestException("Invalid paid operation scope"); }
function reviewTicket(row: ProviderUsageTicket): PaidUsageReviewTicket {
  return { id: row.id, part: row.part, unitsMilli: row.unitsMilli.toString(), startedAt: row.startedAt?.toISOString() ?? row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    resolution: row.resolution as PaidUsageReviewTicket["resolution"], resolvedAt: row.resolvedAt?.toISOString() ?? null, resolutionReason: row.resolutionReason, providerReference: row.providerReference,
    eligibleAt: new Date(Math.max(row.leaseExpiresAt.getTime(), row.startedAt?.getTime() ?? row.createdAt.getTime(), row.finishedAt?.getTime() ?? 0) + reviewDelayMs).toISOString() };
}
