import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  CreatedWorkerNode,
  RemoteRankClaimV1,
  RemoteRankPollTaskV1,
  WorkerNodeView
} from "@seo-platform/contracts";
import { parseRemoteRankClaim } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { internalUuid } from "../internal/internal-command-context.js";
import {
  workerNodeConfiguration,
  workerNodeDraining,
  workerNodeEnabled,
  workerNodeHeartbeat,
  workerNodeId
} from "./worker-node-input.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/platform-admin/worker-nodes")
@UseGuards(PlatformApiGuard)
export class WorkerNodeAdminController {
  public constructor(private readonly nodes: WorkerNodeService) {}

  @Get()
  public async list(
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly WorkerNodeView[]>> {
    actor(headers);
    return response(request, await this.nodes.list());
  }

  @Post()
  @Header("Cache-Control", "no-store")
  public async create(
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CreatedWorkerNode>> {
    actor(headers);
    return response(request, await this.nodes.create(workerNodeConfiguration(body)));
  }

  @Patch(":id/configuration")
  public async configure(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkerNodeView>> {
    actor(headers);
    return response(request, await this.nodes.configure(
      workerNodeId(id), workerNodeConfiguration(body)
    ));
  }

  @Post(":id/rotate")
  @Header("Cache-Control", "no-store")
  public async rotate(
    @Param("id") id: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CreatedWorkerNode>> {
    actor(headers);
    return response(request, await this.nodes.rotate(workerNodeId(id)));
  }

  @Patch(":id/enabled")
  public async enabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkerNodeView>> {
    actor(headers);
    return response(request, await this.nodes.setEnabled(workerNodeId(id), workerNodeEnabled(body)));
  }

  @Patch(":id/draining")
  public async draining(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkerNodeView>> {
    actor(headers);
    return response(request, await this.nodes.setDraining(workerNodeId(id), workerNodeDraining(body)));
  }
}

@Controller("worker/v1")
export class WorkerGatewayController {
  public constructor(
    private readonly nodes: WorkerNodeService,
    private readonly ranks: WorkerRankGatewayService
  ) {}

  @Post("heartbeat")
  @Header("Cache-Control", "no-store")
  public async heartbeat(
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkerNodeView>> {
    const { id, token } = nodeIdentity(headers);
    return response(request, await this.nodes.heartbeat(
      id,
      token,
      workerNodeHeartbeat(body)
    ));
  }

  @Post("rank/claim")
  @Header("Cache-Control", "no-store")
  public async claimRank(
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly RemoteRankPollTaskV1[]>> {
    let input: RemoteRankClaimV1;
    try { input = parseRemoteRankClaim(body); }
    catch { throw new BadRequestException("Invalid available worker capacity"); }
    const { id, token } = nodeIdentity(headers);
    return response(request, await this.ranks.claimBatch(id, token, input.availableSlots));
  }

  @Post("rank/complete")
  @Header("Cache-Control", "no-store")
  public async completeRank(
    @Body() body: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly status: string }>> {
    const input = exact(body, ["schemaVersion", "ticket", "requestSnapshot", "outcome"]);
    if (input.schemaVersion !== "worker-rank-poll-result@1") {
      throw new BadRequestException("Invalid worker rank result");
    }
    const { id, token } = nodeIdentity(headers);
    return response(request, await this.ranks.complete(
      id, token, input.ticket, input.requestSnapshot, input.outcome
    ));
  }
}

function nodeIdentity(headers: HeadersRecord): { readonly id: string; readonly token: string } {
  const id = workerNodeId(headers["x-worker-id"]);
  const authorization = headers.authorization;
  if (typeof authorization !== "string" ||
    !/^Bearer wn_[A-Za-z0-9_-]{43}$/u.test(authorization)) {
    throw new BadRequestException("Invalid worker authentication");
  }
  return { id, token: authorization.slice("Bearer ".length) };
}

function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Invalid worker request");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field))) {
    throw new BadRequestException("Invalid worker request");
  }
  return input;
}

function actor(headers: HeadersRecord): string {
  const value = headers["x-actor-id"];
  if (typeof value !== "string") throw new BadRequestException("Missing trusted actor");
  return internalUuid(value, "actorId");
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
