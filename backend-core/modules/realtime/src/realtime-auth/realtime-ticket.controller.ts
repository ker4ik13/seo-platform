import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  internalIssueRealtimeProjectTicketInput,
  InvalidRealtimeTicketContractError,
  type ApiResponse,
  type RealtimeProjectTicket
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalProjectContext,
  internalUuid
} from "../internal/internal-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { RealtimeTicketService } from "./realtime-ticket.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/realtime-tickets")
@UseGuards(PlatformApiGuard)
export class RealtimeTicketController {
  public constructor(private readonly tickets: RealtimeTicketService) {}

  @Post()
  public async issue(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<RealtimeProjectTicket>> {
    const context = internalProjectContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Trusted project context does not match the route"
      );
    }
    let input;
    try {
      input = internalIssueRealtimeProjectTicketInput(body);
    } catch (error) {
      if (error instanceof InvalidRealtimeTicketContractError) {
        throw new BadRequestException(
          "Invalid realtime ticket authorization command"
        );
      }
      throw error;
    }
    return {
      data: await this.tickets.issue(context, input),
      meta: { requestId: request.id }
    };
  }
}
