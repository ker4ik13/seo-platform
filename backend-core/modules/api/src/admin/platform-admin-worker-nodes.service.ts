import { Injectable } from "@nestjs/common";
import type {
  CreatedWorkerNode,
  WorkerNodeConfiguration,
  WorkerNodeView,
  RemovedWorkerNode
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { JobsClient } from "../jobs/jobs.client.js";

@Injectable()
export class PlatformAdminWorkerNodeService {
  public constructor(
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  public list(actorId: string, requestId: string): Promise<readonly WorkerNodeView[]> {
    return this.jobs.listWorkerNodes(actorId, requestId);
  }

  public async create(
    input: WorkerNodeConfiguration,
    actorId: string,
    requestId: string
  ): Promise<CreatedWorkerNode> {
    const created = await this.jobs.createWorkerNode(actorId, requestId, input);
    await this.audit.record({
      actorId,
      action: "platform_admin.worker_node.created",
      resourceType: "execution_worker_node",
      resourceId: created.node.id,
      redactedChanges: {
        capabilities: [...input.capabilities],
        maxHttpSlots: input.maxHttpSlots,
        maxCpuSlots: input.maxCpuSlots
      },
      requestId
    });
    return created;
  }

  public async remove(id: string, actorId: string, requestId: string): Promise<RemovedWorkerNode> {
    const removed = await this.jobs.removeWorkerNode(actorId, requestId, id);
    await this.audit.record({ actorId, action: "platform_admin.worker_node.deleted", resourceType: "execution_worker_node", resourceId: id, requestId });
    return removed;
  }

  public async configure(
    id: string,
    input: WorkerNodeConfiguration,
    actorId: string,
    requestId: string
  ): Promise<WorkerNodeView> {
    const node = await this.jobs.updateWorkerNode(actorId, requestId, id, "configuration", input);
    await this.audit.record({
      actorId,
      action: "platform_admin.worker_node.configured",
      resourceType: "execution_worker_node",
      resourceId: id,
      redactedChanges: {
        capabilities: [...input.capabilities],
        maxHttpSlots: input.maxHttpSlots,
        maxCpuSlots: input.maxCpuSlots
      },
      requestId
    });
    return node;
  }

  public async rotate(
    id: string,
    actorId: string,
    requestId: string
  ): Promise<CreatedWorkerNode> {
    const rotated = await this.jobs.rotateWorkerNode(actorId, requestId, id);
    await this.audit.record({
      actorId,
      action: "platform_admin.worker_node.credential_rotated",
      resourceType: "execution_worker_node",
      resourceId: id,
      requestId
    });
    return rotated;
  }

  public async enabled(
    id: string,
    enabled: boolean,
    actorId: string,
    requestId: string
  ): Promise<WorkerNodeView> {
    const node = await this.jobs.updateWorkerNode(actorId, requestId, id, "enabled", { enabled });
    await this.audit.record({
      actorId,
      action: enabled ? "platform_admin.worker_node.enabled" : "platform_admin.worker_node.disabled",
      resourceType: "execution_worker_node",
      resourceId: id,
      requestId
    });
    return node;
  }

  public async draining(
    id: string,
    draining: boolean,
    actorId: string,
    requestId: string
  ): Promise<WorkerNodeView> {
    const node = await this.jobs.updateWorkerNode(actorId, requestId, id, "draining", { draining });
    await this.audit.record({
      actorId,
      action: draining ? "platform_admin.worker_node.draining" : "platform_admin.worker_node.resumed",
      resourceType: "execution_worker_node",
      resourceId: id,
      requestId
    });
    return node;
  }
}
