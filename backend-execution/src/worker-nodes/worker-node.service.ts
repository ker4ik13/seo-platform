import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type {
  CreatedWorkerNode,
  WorkerCapability,
  WorkerNodeConfiguration,
  WorkerNodeView
} from "@seo-platform/contracts";
import type { ExecutionWorkerNode } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  type WorkerNodeHeartbeat
} from "./worker-node-input.js";

const TOKEN_PATTERN = /^wn_[A-Za-z0-9_-]{43}$/u;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const VIEW_SELECT = {
  id: true,
  name: true,
  enabled: true,
  draining: true,
  capabilities: true,
  maxHttpSlots: true,
  maxCpuSlots: true,
  reportedHttpSlots: true,
  reportedRankSlots: true,
  reportedCpuSlots: true,
  reportedMemoryBytes: true,
  activeWorkItems: true,
  lastHeartbeatAt: true,
  lastProtocolVersion: true
} as const;

@Injectable()
export class WorkerNodeService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(input: WorkerNodeConfiguration): Promise<CreatedWorkerNode> {
    const token = newNodeToken();
    const row = await this.prisma.executionWorkerNode.create({
      data: {
        name: input.name,
        tokenHash: tokenHash(token),
        capabilities: [...input.capabilities],
        maxHttpSlots: input.maxHttpSlots,
        maxCpuSlots: input.maxCpuSlots,
        enabled: false
      }
    });
    return { node: view(row), token };
  }

  public async rotate(id: string): Promise<CreatedWorkerNode> {
    const token = newNodeToken();
    const changed = await this.prisma.executionWorkerNode.updateMany({
      where: { id },
      data: { tokenHash: tokenHash(token), draining: true }
    });
    if (changed.count !== 1) throw new NotFoundException("Worker node not found");
    return { node: await this.get(id), token };
  }

  public async list(): Promise<readonly WorkerNodeView[]> {
    const [rows, assignments] = await Promise.all([
      this.prisma.executionWorkerNode.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
        select: VIEW_SELECT
      }),
      this.prisma.$queryRaw<readonly {
        readonly nodeId: string;
        readonly jobId: string;
        readonly searchEngine: string | null;
        readonly activeTasks: bigint;
      }[]>`
        SELECT * FROM public.list_remote_worker_rank_assignments(1000)
      `
    ]);
    const byNode = new Map<string, NonNullable<WorkerNodeView["activeAssignments"]>[number][]>();
    for (const assignment of assignments) {
      const values = byNode.get(assignment.nodeId) ?? [];
      values.push({
        jobId: assignment.jobId,
        capability: "RANK",
        searchEngine: assignment.searchEngine === "YANDEX" || assignment.searchEngine === "GOOGLE"
          ? assignment.searchEngine
          : null,
        activeTasks: Number(assignment.activeTasks)
      });
      byNode.set(assignment.nodeId, values);
    }
    return rows.map((row) => ({
      ...view(row),
      activeAssignments: byNode.get(row.id) ?? []
    }));
  }

  public async setEnabled(id: string, enabled: boolean): Promise<WorkerNodeView> {
    const changed = await this.prisma.executionWorkerNode.updateMany({
      where: { id }, data: { enabled, draining: !enabled }
    });
    if (changed.count !== 1) throw new NotFoundException("Worker node not found");
    return this.get(id);
  }

  public async setDraining(id: string, draining: boolean): Promise<WorkerNodeView> {
    const changed = await this.prisma.executionWorkerNode.updateMany({
      where: { id }, data: { draining }
    });
    if (changed.count !== 1) throw new NotFoundException("Worker node not found");
    return this.get(id);
  }

  public async configure(id: string, input: WorkerNodeConfiguration): Promise<WorkerNodeView> {
    const changed = await this.prisma.executionWorkerNode.updateMany({
      where: { id },
      data: {
        name: input.name,
        capabilities: [...input.capabilities],
        maxHttpSlots: input.maxHttpSlots,
        maxCpuSlots: input.maxCpuSlots
      }
    });
    if (changed.count !== 1) throw new NotFoundException("Worker node not found");
    return this.get(id);
  }

  public async heartbeat(id: string, token: string, input: WorkerNodeHeartbeat): Promise<WorkerNodeView> {
    const row = await this.authenticate(id, token);
    const changed = await this.prisma.executionWorkerNode.updateMany({
      where: { id, tokenHash: Uint8Array.from(row.tokenHash) },
      data: {
        reportedHttpSlots: input.httpSlots,
        reportedRankSlots: input.rankSlots,
        reportedCpuSlots: input.cpuSlots,
        reportedMemoryBytes: input.memoryBytes,
        activeWorkItems: input.activeWorkItems,
        lastHeartbeatAt: new Date(),
        lastProtocolVersion: input.protocolVersion
      }
    });
    if (changed.count !== 1) throw new UnauthorizedException("Invalid worker node");
    return this.get(id);
  }

  public async authorizeForWork(
    id: string,
    token: string,
    capability: WorkerCapability
  ): Promise<{ readonly httpSlots: number; readonly cpuSlots: number }> {
    const row = await this.authenticate(id, token);
    if (
      !row.enabled || row.draining ||
      !row.capabilities.includes(capability) ||
      !row.lastHeartbeatAt ||
      Date.now() - row.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS
    ) {
      throw new ForbiddenException("Worker node is unavailable for this capability");
    }
    const httpSlots = Math.min(
      row.maxHttpSlots,
      row.reportedHttpSlots,
      capability === "RANK" ? row.reportedRankSlots : row.reportedHttpSlots
    );
    const cpuSlots = Math.min(row.maxCpuSlots, row.reportedCpuSlots);
    if (httpSlots < 1 && cpuSlots < 1) {
      throw new ForbiddenException("Worker node has no capacity");
    }
    return { httpSlots, cpuSlots };
  }

  public async authenticateForCompletion(id: string, token: string): Promise<void> {
    await this.authenticate(id, token);
  }

  private async authenticate(id: string, token: string): Promise<ExecutionWorkerNode> {
    if (!TOKEN_PATTERN.test(token)) throw new UnauthorizedException("Invalid worker node");
    const row = await this.prisma.executionWorkerNode.findUnique({ where: { id } });
    const actual = tokenHash(token);
    if (!row || row.tokenHash.length !== actual.length ||
      !timingSafeEqual(row.tokenHash, actual)) {
      throw new UnauthorizedException("Invalid worker node");
    }
    return row;
  }

  private async get(id: string): Promise<WorkerNodeView> {
    const row = await this.prisma.executionWorkerNode.findUnique({
      where: { id }, select: VIEW_SELECT
    });
    if (!row) throw new NotFoundException("Worker node not found");
    return view(row);
  }
}

function tokenHash(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash("sha256").update(token, "utf8").digest());
}

function newNodeToken(): string {
  return `wn_${randomBytes(32).toString("base64url")}`;
}

function view(row: {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly draining: boolean;
  readonly capabilities: readonly string[];
  readonly maxHttpSlots: number;
  readonly maxCpuSlots: number;
  readonly reportedHttpSlots: number;
  readonly reportedRankSlots: number;
  readonly reportedCpuSlots: number;
  readonly reportedMemoryBytes: bigint;
  readonly activeWorkItems: number;
  readonly lastHeartbeatAt: Date | null;
  readonly lastProtocolVersion: number | null;
}): WorkerNodeView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    draining: row.draining,
    capabilities: row.capabilities as WorkerCapability[],
    maxHttpSlots: row.maxHttpSlots,
    maxCpuSlots: row.maxCpuSlots,
    reportedHttpSlots: row.reportedHttpSlots,
    reportedRankSlots: row.reportedRankSlots,
    reportedCpuSlots: row.reportedCpuSlots,
    reportedMemoryBytes: row.reportedMemoryBytes.toString(),
    activeWorkItems: row.activeWorkItems,
    online: row.lastHeartbeatAt !== null && Date.now() - row.lastHeartbeatAt.getTime() < HEARTBEAT_TIMEOUT_MS,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    protocolVersion: row.lastProtocolVersion
  };
}
