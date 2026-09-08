import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { IntegrationCapability, PrepareSystemConnectorsResult } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";
import { WorkspaceConnectorRoutingService } from "./workspace-connector-routing.service.js";

const CAPABILITIES: readonly IntegrationCapability[] = ["SERP_RANK_TRACKING", "SERP_COLLECTION", "WORDSTAT", "CLUSTERING", "KEYWORD_RESEARCH"];
@Injectable()
export class SystemConnectorBootstrapService {
  public constructor(private readonly prisma: PrismaService, private readonly credentials: IntegrationCredentialService, private readonly validations: IntegrationCredentialValidationService, private readonly routing: WorkspaceConnectorRoutingService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async prepare(workspaceId: string, projectId: string, actorId: string, requestId: string): Promise<PrepareSystemConnectorsResult> {
    const configured = (["XMLSTOCK", "ARSENKIN"] as const).filter(provider => this.config.platformProviderCredentials[provider]);
    if (!configured.length) return { configured: false, pending: false, readyProviders: [] };
    const [projectBindings, workspaceBindings] = await Promise.all([
      this.prisma.projectConnectorBinding.findMany({ where: { workspaceId, projectId }, select: { capability: true } }),
      this.prisma.workspaceConnectorBinding.findMany({ where: { workspaceId }, select: { capability: true } })
    ]);
    const configuredCapabilities = new Set([...projectBindings, ...workspaceBindings].map(row => row.capability));
    const missing = CAPABILITIES.filter(capability => !configuredCapabilities.has(capability));
    const ready: Array<{ id: string; provider: "XMLSTOCK" | "ARSENKIN"; capabilities: readonly string[] }> = [];
    let pending = false;
    if (missing.length > 0) for (const provider of configured) {
      let credential = await this.prisma.integrationCredential.findFirst({ where: { workspaceId, provider, mode: "PLATFORM_PAID", deletedAt: null } });
      if (!credential) {
        // A deliberately deleted system connection is an opt-out, not a reason
        // to recreate it silently whenever a collection modal opens.
        if (await this.prisma.integrationCredential.findFirst({ where: { workspaceId, provider, mode: "PLATFORM_PAID", deletedAt: { not: null } }, select: { id: true } })) continue;
        try { await this.credentials.enablePlatform({ workspaceId, actorId, provider, idempotencyKey: `auto-system:${workspaceId}:${provider}` }, this.config.platformProviderCredentials[provider]!); }
        catch (error) { if (!(error instanceof ConflictException)) throw error; }
        credential = await this.prisma.integrationCredential.findFirst({ where: { workspaceId, provider, mode: "PLATFORM_PAID", deletedAt: null } });
      }
      if (!credential) continue;
      if (credential.status === "PENDING_VERIFICATION") {
        try { await this.validations.request(credential.id, { workspaceId, actorId, idempotencyKey: `auto-system-validation:${credential.id}:${credential.materialVersion}` }, requestId); }
        catch (error) { if (!(error instanceof ConflictException)) throw error; }
        pending = true;
      } else if (credential.status === "ACTIVE") {
        ready.push({ id: credential.id, provider, capabilities: Array.isArray(credential.capabilities) ? credential.capabilities.filter((value): value is string => typeof value === "string") : [] });
      }
    }
    for (const capability of missing) {
      const candidates = ready.filter(credential => credential.capabilities.includes(capability) && (!["SERP_COLLECTION", "CLUSTERING"].includes(capability) || credential.provider === "ARSENKIN"));
      if (!candidates.length) continue;
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`system-connectors:${workspaceId}`}, 0))`;
        const project = await tx.projectConnectorBinding.findUnique({ where: { workspaceId_projectId_capability: { workspaceId, projectId, capability } }, select: { id: true } });
        const current = await tx.workspaceConnectorBinding.findUnique({ where: { workspaceId_capability: { workspaceId, capability } }, select: { id: true } });
        if (project || current) return;
        const binding = await tx.workspaceConnectorBinding.create({ data: { workspaceId, capability, enabled: true, createdBy: actorId, updatedBy: actorId, fallbackMode: candidates.length > 1 ? "NEXT_AVAILABLE" : "NONE", fallbackReasons: candidates.length > 1 ? ["CREDENTIAL_UNAVAILABLE"] : [] } });
        await tx.workspaceConnectorRoute.createMany({ data: candidates.map((credential, position) => ({ workspaceId, bindingId: binding.id, credentialId: credential.id, position })) });
      });
    }
    // The existing resolver materializes inherited project snapshots and
    // preserves every explicit project override/disabled route.
    for (const capability of CAPABILITIES) {
      try { await this.routing.resolve(workspaceId, projectId, capability, actorId); }
      catch (error) { if (!(error instanceof ConflictException)) throw error; }
    }
    return { configured: true, pending, readyProviders: ready.map(row => row.provider) };
  }
}
