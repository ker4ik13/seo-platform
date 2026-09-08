import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";

@Injectable()
export class PlatformAccountProbeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly owner = `account-probe-${randomUUID()}`;
  private readonly logger = new Logger(PlatformAccountProbeService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private running = false;
  public constructor(private readonly prisma: PrismaService, private readonly crypto: IntegrationCredentialCryptoService, private readonly connectors: IntegrationCredentialConnectorRegistry, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  public onApplicationBootstrap() { this.schedule(5000); }
  public async onModuleDestroy() { this.stopping = true; clearTimeout(this.timer); while (this.running) await new Promise(resolve => setTimeout(resolve, 50)); }
  private schedule(ms: number) { if (this.stopping) return; this.timer = setTimeout(() => void this.tick(), ms); this.timer.unref(); }
  private async tick() {
    if (this.stopping || this.running) return; this.running = true;
    try { for (let count = 0; count < 10 && !this.stopping; count++) if (!await this.probeOne()) break; }
    catch { this.logger.warn("PLATFORM_ACCOUNT_PROBE_UNAVAILABLE"); }
    finally { this.running = false; this.schedule(5000); }
  }
  public async probeOne(): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<{ claim: unknown }[]>`SELECT public.claim_platform_provider_account_probe(${this.owner}::text) AS claim`;
    if (!row?.claim) return false;
    const claim = parseClaim(row.claim);
    let remaining: string | null = null, error: string | null = null;
    try {
      const secret = this.crypto.decrypt(claim.workspaceId, claim.provider, claim.credentialId, { ciphertext: decode(claim.ciphertext), nonce: decode(claim.nonce), authTag: decode(claim.authTag), encryptedDataKey: decode(claim.encryptedDataKey), dataKeyNonce: decode(claim.dataKeyNonce), dataKeyAuthTag: decode(claim.dataKeyAuthTag), keyVersion: claim.keyVersion });
      const entry = secret.platformPool?.find(item => item.id === claim.id);
      const selected = entry ? { apiKey: entry.apiKey, ...(entry.accountIdentifier ? { accountIdentifier: entry.accountIdentifier } : {}), rateLimitScopeId: entry.id } : secret.rateLimitScopeId === claim.id ? secret : undefined;
      if (!selected) throw new Error("Account pool scope changed");
      const result = await this.connectors.validate(claim.provider, selected, Math.min(10_000, this.config.integrationCredentialValidation.timeoutMs));
      if (!result.ok) error = result.errorCode;
      else {
        const account = result.providerMeta?.account;
        const candidate = claim.provider === "ARSENKIN" ? result.providerMeta?.limitsTotal : account && typeof account === "object" && !Array.isArray(account) ? (account as Record<string, unknown>).balance : undefined;
        if ((typeof candidate !== "number" && typeof candidate !== "string") || !/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$/u.test(String(candidate))) throw new Error("Invalid provider balance");
        remaining = String(candidate);
      }
    } catch { error = "ACCOUNT_PROBE_FAILED"; }
    await this.prisma.$queryRaw`SELECT public.finish_platform_provider_account_probe(${claim.id}::uuid, ${this.owner}::text, ${claim.token}::uuid, ${remaining}::text, ${error}::text)`;
    return true;
  }
}
interface Claim { id: string; provider: "XMLSTOCK" | "ARSENKIN"; token: string; workspaceId: string; credentialId: string; ciphertext: string; nonce: string; authTag: string; encryptedDataKey: string; dataKeyNonce: string; dataKeyAuthTag: string; keyVersion: number }
function parseClaim(value: unknown): Claim {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid account probe claim");
  const input = value as Record<string, unknown>;
  for (const key of ["id", "token", "workspaceId", "credentialId"]) if (typeof input[key] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input[key])) throw new Error("Invalid account probe scope");
  if ((input.provider !== "XMLSTOCK" && input.provider !== "ARSENKIN") || !Number.isSafeInteger(input.keyVersion) || Number(input.keyVersion) < 1) throw new Error("Invalid account probe provider");
  for (const key of ["ciphertext", "nonce", "authTag", "encryptedDataKey", "dataKeyNonce", "dataKeyAuthTag"]) decode(input[key]);
  return input as unknown as Claim;
}
function decode(value: unknown): Buffer { if (typeof value !== "string" || value.length > 100_000 || !/^[A-Za-z0-9+/=\s]+$/u.test(value)) throw new Error("Invalid encrypted account envelope"); return Buffer.from(value, "base64"); }
