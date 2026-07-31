import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticCluster,
  SemanticClusterPageBulkPreview,
  SemanticClusterPageBulkResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateSemanticClusterInput,
  internalDeleteSemanticClusterInput,
  internalSemanticClusterPageBulkInput,
  internalUpdateSemanticClusterInput
} from "./cluster-input.js";
import { ClusterService } from "./cluster.service.js";

type InternalHeaders = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/clusters")
@UseGuards(PlatformApiGuard)
export class ClusterController {
  public constructor(private readonly clusters: ClusterService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticCluster[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.clusters.list(context.workspaceId, context.projectId),
      meta: { requestId: request.id }
    };
  }

  @Post()
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticCluster>> {
    const input = internalCreateSemanticClusterInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.clusters.create(input));
  }

  @Post("page-mapping-preview")
  @HttpCode(HttpStatus.OK)
  public async previewPageMapping(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticClusterPageBulkPreview>> {
    const input = internalSemanticClusterPageBulkInput(body);
    assertMutation(projectId, headers, input);
    return {
      data: await this.clusters.previewPageMapping(input),
      meta: { requestId: request.id }
    };
  }

  @Post("page-mapping-bulk")
  @HttpCode(HttpStatus.OK)
  public async bulkUpdatePageMapping(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticClusterPageBulkResult>> {
    const input = internalSemanticClusterPageBulkInput(body);
    assertMutation(projectId, headers, input);
    return {
      data: await this.clusters.bulkUpdatePageMapping(input),
      meta: { requestId: request.id }
    };
  }

  @Patch(":clusterId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("clusterId") clusterId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticCluster>> {
    const input = internalUpdateSemanticClusterInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.clusters.update(internalUuid(clusterId, "clusterId"), input)
    );
  }

  @Delete(":clusterId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("clusterId") clusterId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteSemanticClusterInput(body);
    assertMutation(projectId, headers, input);
    await this.clusters.delete(internalUuid(clusterId, "clusterId"), input);
  }
}

function routeContext(projectId: string, headers: InternalHeaders) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function assertMutation(
  projectId: string,
  headers: InternalHeaders,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  const context = routeContext(projectId, headers);
  assertInternalContext(context, input);
}

function response(
  request: FastifyRequest,
  data: SemanticCluster
): ApiResponse<SemanticCluster> {
  return { data, meta: { requestId: request.id, version: data.version } };
}
