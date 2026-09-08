import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { OperationEstimateCommand } from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { internalProjectContext, requiredMutableProjectTenant } from "../authorization/project-tenant.js";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { RankExecutionGrantSettlementGuard } from "../rankings/rank-execution-grant-settlement.guard.js";
import { createFrequencyCollectionInput } from "../semantics/frequency-collection-input.js";
import { createAiAnswerCollectionInput } from "../semantics/ai-answer-collection-input.js";
import { createClusteringRunInput } from "../semantics/clustering-run-input.js";
import { createKeywordResearchRunInput } from "../keyword-research/keyword-research.input.js";
import { OperationBillingService } from "./operation-billing.service.js";

@Controller("api/v1/projects/:projectId/operation-estimates")
export class OperationEstimateController {
  public constructor(private readonly billing: OperationBillingService) {}
  @Post() @RequirePermission("collector.run") @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async estimate(@Body() body: unknown, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const tenant = requiredMutableProjectTenant(request);
    return apiResponse(request, await this.billing.estimate(internalProjectContext(request, principal, tenant), operationEstimateCommand(body)));
  }
}

@Controller("internal/v1/billing/operations")
@UseGuards(RankExecutionGrantSettlementGuard)
export class OperationBillingController {
  public constructor(private readonly billing: OperationBillingService) {}
  @Post(":quoteId/authorize")
  public async authorize(@Param("quoteId") quoteId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["ticketId", "ticketToken"].includes(key))) throw new BadRequestException();
    const input = body as Record<string, unknown>;
    await this.billing.authorize(assertUuid(quoteId, "quoteId"), assertUuid(String(input.ticketId), "ticketId"), assertUuid(String(input.ticketToken), "ticketToken"));
    return apiResponse(request, { permitted: true });
  }
}

export function operationEstimateCommand(body: unknown): OperationEstimateCommand {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["kind", "command"].includes(key))) throw new BadRequestException("Invalid operation estimate");
  const input = body as Record<string, unknown>;
  switch (input.kind) {
    case "FREQUENCY_COLLECTION": return { kind: input.kind, command: createFrequencyCollectionInput(input.command) };
    case "AI_ANSWER_COLLECTION": return { kind: input.kind, command: createAiAnswerCollectionInput(input.command) };
    case "CLUSTERING_RUN": return { kind: input.kind, command: createClusteringRunInput(input.command) };
    case "KEYWORD_RESEARCH": return { kind: input.kind, command: createKeywordResearchRunInput(input.command) };
    default: throw new BadRequestException("Invalid operation estimate kind");
  }
}
