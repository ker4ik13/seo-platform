import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import type {
  IntegrationCredentialSummary,
  IntegrationCredentialValidationSummary,
  IntegrationProvider,
  InternalCreateIntegrationCredentialInput,
  InternalEnablePlatformIntegrationCredentialInput,
  InternalUpdateIntegrationCredentialInput
} from "@seo-platform/contracts";
import type { IntegrationCredential } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeIntegrationCredentialCapabilities } from "./integration-credential-capabilities.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import type { PlatformCredentialMaterial } from "./integration-credential-crypto.service.js";
import { integrationCredentialId } from "./integration-credential-id.js";
import {
  ACTIVE_INTEGRATION_CREDENTIAL_VALIDATION_JOB_STATUSES,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  toValidationSummary
} from "./integration-credential-validation-job.js";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";

type IntegrationCredentialSummaryRecord = Pick<
  IntegrationCredential,
  | "id"
  | "workspaceId"
  | "provider"
  | "label"
  | "mode"
  | "status"
  | "displayHint"
  | "verifiedAt"
  | "lastSuccessAt"
  | "lastErrorAt"
  | "lastErrorCode"
  | "capabilities"
  | "providerMeta"
  | "materialVersion"
  | "version"
  | "createdAt"
  | "updatedAt"
>;

const CREDENTIAL_SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  provider: true,
  label: true,
  mode: true,
  status: true,
  displayHint: true,
  verifiedAt: true,
  lastSuccessAt: true,
  lastErrorAt: true,
  lastErrorCode: true,
  capabilities: true,
  providerMeta: true,
  materialVersion: true,
  version: true,
  createdAt: true,
  updatedAt: true
} as const;

@Injectable()
export class IntegrationCredentialService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IntegrationCredentialCryptoService
  ) {}

  public async list(
    workspaceId: string
  ): Promise<readonly IntegrationCredentialSummary[]> {
    const credentials = await this.prisma.integrationCredential.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: CREDENTIAL_SUMMARY_SELECT
    });
    if (credentials.length === 0) return [];

    const validations = await this.prisma.job.findMany({
      where: {
        workspaceId,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        status: {
          in: [
            ...ACTIVE_INTEGRATION_CREDENTIAL_VALIDATION_JOB_STATUSES
          ]
        },
        deduplicationKey: {
          in: credentials.map((credential) =>
            integrationCredentialValidationDeduplicationKey(
              credential.id,
              credential.materialVersion
            )
          )
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const activeByCredential = new Map<
      string,
      IntegrationCredentialValidationSummary
    >();
    const credentialById = new Map(
      credentials.map((credential) => [credential.id, credential])
    );
    for (const validation of validations) {
      const summary = toValidationSummary(validation);
      const credential = credentialById.get(summary.credentialId);
      if (
        !credential ||
        summary.credentialMaterialVersion !==
          credential.materialVersion ||
        validation.deduplicationKey !==
          integrationCredentialValidationDeduplicationKey(
            credential.id,
            credential.materialVersion
          ) ||
        activeByCredential.has(summary.credentialId)
      ) {
        throw new Error(
          "Invalid active credential validation projection"
        );
      }
      activeByCredential.set(summary.credentialId, summary);
    }
    return credentials.map((credential) =>
      toSummary(credential, activeByCredential.get(credential.id))
    );
  }

  public async create(
    input: InternalCreateIntegrationCredentialInput
  ): Promise<IntegrationCredentialSummary> {
    const existing = await this.findIdempotent(input);
    if (existing) return toSummary(existing);

    const metadata = integrationProviderMetadata(input.provider);
    const credentialId = integrationCredentialId();
    const encrypted = this.crypto.encrypt(
      input.workspaceId,
      input.provider,
      credentialId,
      {
        apiKey: input.apiKey,
        ...(input.accountIdentifier
          ? { accountIdentifier: input.accountIdentifier }
          : {})
      }
    );
    const requestFingerprint = this.crypto.requestFingerprint(
      requestFingerprintInput(input)
    );
    try {
      const credential = await this.prisma.integrationCredential.create({
        data: {
          id: credentialId,
          workspaceId: input.workspaceId,
          provider: input.provider,
          label: input.label,
          mode: "BYOK_API_KEY",
          status: "PENDING_VERIFICATION",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: databaseBytes(requestFingerprint.digest),
          fingerprintKeyVersion: requestFingerprint.keyVersion,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          ...encryptedForDatabase(encrypted),
          displayHint: displayHint(input.apiKey),
          capabilities: [...metadata.capabilities],
          providerMeta: {
            accountIdentifierConfigured: Boolean(input.accountIdentifier)
          }
        }
      });
      return toSummary(credential);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.findIdempotent(input);
        if (winner) return toSummary(winner);
      }
      throw error;
    }
  }

  public async enablePlatform(
    input: InternalEnablePlatformIntegrationCredentialInput,
    material: readonly PlatformCredentialMaterial[]
  ): Promise<IntegrationCredentialSummary> {
    const existing = await this.findPlatformIdempotent(input, material);
    if (existing) return toSummary(existing);
    if (await this.findActivePlatform(input)) {
      throw platformAlreadyEnabled();
    }

    const credentialId = integrationCredentialId();
    const label = platformCredentialLabel(input.provider);
    const secret = this.crypto.platformCredentialPoolSecret(
      input.provider,
      material
    );
    const encrypted = this.crypto.encrypt(
      input.workspaceId,
      input.provider,
      credentialId,
      secret
    );
    const fingerprintKeyVersion =
      this.crypto.platformCredentialFingerprintKeyVersion();
    const requestFingerprint = this.crypto.requestFingerprint(
      platformFingerprintInput(input, material, label),
      fingerprintKeyVersion
    );
    try {
      const credential = await this.prisma.integrationCredential.create({
        data: {
          id: credentialId,
          workspaceId: input.workspaceId,
          provider: input.provider,
          label,
          mode: "PLATFORM_PAID",
          status: "PENDING_VERIFICATION",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: databaseBytes(requestFingerprint.digest),
          fingerprintKeyVersion: requestFingerprint.keyVersion,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          ...encryptedForDatabase(encrypted),
          displayHint: "Системный",
          capabilities: ["SERP_RANK_TRACKING"],
          providerMeta: {
            accountIdentifierConfigured: material.every((entry) =>
              Boolean(entry.accountIdentifier)
            ),
            platformPoolSize: material.length
          }
        }
      });
      return toSummary(credential);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.findPlatformIdempotent(input, material);
        if (winner) return toSummary(winner);
        if (await this.findActivePlatform(input)) {
          throw platformAlreadyEnabled();
        }
      }
      throw error;
    }
  }

  public async update(
    credentialId: string,
    input: InternalUpdateIntegrationCredentialInput
  ): Promise<IntegrationCredentialSummary> {
    const current = await this.load(credentialId, input.workspaceId);
    if (current.version !== input.version) throw versionConflict();
    if (current.mode !== "BYOK_API_KEY") {
      throw new UnprocessableEntityException(
        "Platform credentials cannot be edited"
      );
    }
    const provider = providerValue(current.provider);
    const secretChanged =
      input.apiKey !== undefined || input.accountIdentifier !== undefined;
    let rotation:
      | {
          readonly encrypted: ReturnType<
            IntegrationCredentialCryptoService["encrypt"]
          >;
          readonly displayHint: string;
          readonly accountIdentifierConfigured: boolean;
        }
      | undefined;

    if (secretChanged) {
      if (!input.apiKey) {
        throw new UnprocessableEntityException(
          "A complete replacement secret is required"
        );
      }
      const secret = {
        apiKey: input.apiKey,
        ...(input.accountIdentifier
          ? { accountIdentifier: input.accountIdentifier }
          : {})
      };
      if (
        integrationProviderMetadata(provider).requiresAccountIdentifier &&
        !secret.accountIdentifier
      ) {
        throw new UnprocessableEntityException(
          "Provider account identifier is required"
        );
      }
      rotation = {
        encrypted: this.crypto.encrypt(
          current.workspaceId,
          provider,
          current.id,
          secret
        ),
        displayHint: displayHint(secret.apiKey),
        accountIdentifierConfigured: Boolean(secret.accountIdentifier)
      };
    }

    try {
      const updated = await this.prisma.integrationCredential.update({
        where: {
          id: current.id,
          workspaceId: input.workspaceId,
          deletedAt: null,
          version: input.version
        },
        data: {
          label: input.label,
          updatedBy: input.actorId,
          ...(rotation
            ? {
                ...encryptedForDatabase(rotation.encrypted),
                displayHint: rotation.displayHint,
                providerMeta: {
                  accountIdentifierConfigured:
                    rotation.accountIdentifierConfigured
                },
                status: "PENDING_VERIFICATION" as const,
                verifiedAt: null,
                lastErrorAt: null,
                lastErrorCode: null,
                materialVersion: { increment: 1 }
              }
            : {}),
          version: { increment: 1 }
        }
      });
      return toSummary(updated);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw versionConflict();
      throw error;
    }
  }

  public async revoke(
    credentialId: string,
    workspaceId: string,
    version: number,
    actorId: string
  ): Promise<void> {
    const current = await this.load(credentialId, workspaceId);
    if (current.version !== version) throw versionConflict();
    try {
      await this.prisma.integrationCredential.update({
        where: {
          id: credentialId,
          workspaceId,
          deletedAt: null,
          version
        },
        data: {
          status: "REVOKED",
          updatedBy: actorId,
          deletedAt: new Date(),
          ciphertext: databaseBytes(
            randomBytes(Math.max(current.ciphertext.length, 32))
          ),
          nonce: databaseBytes(randomBytes(12)),
          authTag: databaseBytes(randomBytes(16)),
          encryptedDataKey: databaseBytes(
            randomBytes(Math.max(current.encryptedDataKey.length, 32))
          ),
          dataKeyNonce: databaseBytes(randomBytes(12)),
          dataKeyAuthTag: databaseBytes(randomBytes(16)),
          requestFingerprint: databaseBytes(randomBytes(32)),
          displayHint: null,
          providerMeta: {},
          materialVersion: { increment: 1 },
          version: { increment: 1 }
        }
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) throw versionConflict();
      throw error;
    }
  }

  private async load(
    credentialId: string,
    workspaceId: string
  ): Promise<IntegrationCredential> {
    const credential = await this.prisma.integrationCredential.findFirst({
      where: { id: credentialId, workspaceId, deletedAt: null }
    });
    if (!credential) throw new NotFoundException("Credential not found");
    return credential;
  }

  private async findIdempotent(
    input: InternalCreateIntegrationCredentialInput
  ): Promise<IntegrationCredential | null> {
    const credential =
      await this.prisma.integrationCredential.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
    if (!credential) return null;
    if (
      credential.deletedAt ||
      credential.mode !== "BYOK_API_KEY" ||
      credential.provider !== input.provider
    ) {
      throw idempotencyConflict();
    }
    const candidate = this.crypto.requestFingerprint(
      requestFingerprintInput(input),
      credential.fingerprintKeyVersion
    );
    if (
      !safeEqual(
        Buffer.from(credential.requestFingerprint),
        candidate.digest
      )
    ) {
      throw idempotencyConflict();
    }
    return credential;
  }

  private findActivePlatform(
    input: InternalEnablePlatformIntegrationCredentialInput
  ): Promise<IntegrationCredential | null> {
    return this.prisma.integrationCredential.findFirst({
      where: {
        workspaceId: input.workspaceId,
        provider: input.provider,
        mode: "PLATFORM_PAID",
        deletedAt: null
      }
    });
  }

  private async findPlatformIdempotent(
    input: InternalEnablePlatformIntegrationCredentialInput,
    material: readonly PlatformCredentialMaterial[]
  ): Promise<IntegrationCredential | null> {
    const credential =
      await this.prisma.integrationCredential.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
    if (!credential) return null;
    if (
      credential.deletedAt ||
      credential.mode !== "PLATFORM_PAID" ||
      credential.provider !== input.provider
    ) {
      throw idempotencyConflict();
    }
    const candidate = this.crypto.requestFingerprint(
      platformFingerprintInput(
        input,
        material,
        platformCredentialLabel(input.provider)
      ),
      credential.fingerprintKeyVersion
    );
    const storedFingerprint = Buffer.from(credential.requestFingerprint);
    if (!safeEqual(storedFingerprint, candidate.digest)) {
      const legacyCandidate = material.length === 1
        ? this.crypto.requestFingerprint(
            platformFingerprintInput(
              input,
              material,
              platformCredentialLabel(input.provider),
              false
            ),
            credential.fingerprintKeyVersion
          )
        : undefined;
      if (
        !legacyCandidate ||
        !safeEqual(storedFingerprint, legacyCandidate.digest)
      ) {
        throw idempotencyConflict();
      }
    }
    return credential;
  }
}

function requestFingerprintInput(
  input: InternalCreateIntegrationCredentialInput
): Parameters<
  IntegrationCredentialCryptoService["requestFingerprint"]
>[0] {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    provider: input.provider,
    label: input.label,
    apiKey: input.apiKey,
    ...(input.accountIdentifier
      ? { accountIdentifier: input.accountIdentifier }
      : {})
  };
}

function platformFingerprintInput(
  input: InternalEnablePlatformIntegrationCredentialInput,
  material: readonly PlatformCredentialMaterial[],
  label: string,
  includePool = true
): Parameters<
  IntegrationCredentialCryptoService["requestFingerprint"]
>[0] {
  const first = material[0];
  if (!first) {
    throw new UnprocessableEntityException(
      "Platform credential pool cannot be empty"
    );
  }
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    provider: input.provider,
    label,
    apiKey: first.apiKey,
    ...(first.accountIdentifier
      ? { accountIdentifier: first.accountIdentifier }
      : {}),
    ...(includePool ? { platformPool: material } : {})
  };
}

function platformCredentialLabel(
  provider: "XMLSTOCK" | "ARSENKIN"
): string {
  return provider === "XMLSTOCK"
    ? "XMLStock — внутренние токены"
    : "Arsenkin — внутренние токены";
}

function encryptedForDatabase(
  encrypted: ReturnType<IntegrationCredentialCryptoService["encrypt"]>
): {
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly authTag: Uint8Array<ArrayBuffer>;
  readonly encryptedDataKey: Uint8Array<ArrayBuffer>;
  readonly dataKeyNonce: Uint8Array<ArrayBuffer>;
  readonly dataKeyAuthTag: Uint8Array<ArrayBuffer>;
  readonly keyVersion: number;
} {
  return {
    ciphertext: databaseBytes(encrypted.ciphertext),
    nonce: databaseBytes(encrypted.nonce),
    authTag: databaseBytes(encrypted.authTag),
    encryptedDataKey: databaseBytes(encrypted.encryptedDataKey),
    dataKeyNonce: databaseBytes(encrypted.dataKeyNonce),
    dataKeyAuthTag: databaseBytes(encrypted.dataKeyAuthTag),
    keyVersion: encrypted.keyVersion
  };
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function toSummary(
  credential: IntegrationCredentialSummaryRecord,
  activeValidation?: IntegrationCredentialValidationSummary
): IntegrationCredentialSummary {
  const provider = providerValue(credential.provider);
  return {
    id: credential.id,
    workspaceId: credential.workspaceId,
    provider,
    label: credential.label,
    mode: credential.mode,
    status: credential.status,
    displayHint: credential.displayHint ?? "••••",
    capabilities: safeIntegrationCredentialCapabilities(
      provider,
      credential.capabilities
    ),
    quota:
      credential.mode === "PLATFORM_PAID"
        ? { status: "NOT_AVAILABLE" }
        : safeCredentialQuota(
            provider,
            credential.providerMeta,
            credential.lastSuccessAt
          ),
    ...(credential.verifiedAt
      ? { verifiedAt: credential.verifiedAt.toISOString() }
      : {}),
    ...(credential.lastSuccessAt
      ? { lastSuccessAt: credential.lastSuccessAt.toISOString() }
      : {}),
    ...(credential.lastErrorAt
      ? { lastErrorAt: credential.lastErrorAt.toISOString() }
      : {}),
    ...(credential.lastErrorCode
      ? { lastErrorCode: credential.lastErrorCode }
      : {}),
    ...(activeValidation ? { activeValidation } : {}),
    version: credential.version,
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString()
  };
}

export function safeCredentialQuota(
  provider: IntegrationProvider,
  providerMeta: unknown,
  lastSuccessAt: Date | null
): IntegrationCredentialSummary["quota"] {
  if (!isRecord(providerMeta)) return { status: "NOT_AVAILABLE" };
  const observedAt = lastSuccessAt?.toISOString();
  if (provider === "ARSENKIN") {
    const remaining = nonNegativeSafeInteger(providerMeta.limitsTotal);
    return remaining === undefined
      ? { status: "NOT_AVAILABLE" }
      : {
          status: "AVAILABLE",
          unit: "ARSENKIN_LIMITS",
          remaining,
          ...(observedAt ? { observedAt } : {})
        };
  }
  if (provider === "KEYS_SO" && isRecord(providerMeta.apiRequest)) {
    const limit = nonNegativeSafeInteger(providerMeta.apiRequest.limit);
    const used = nonNegativeSafeInteger(providerMeta.apiRequest.usedLimit);
    if (limit === undefined || used === undefined) {
      return { status: "NOT_AVAILABLE" };
    }
    return {
      status: "AVAILABLE",
      unit: "API_REQUESTS",
      limit,
      used,
      remaining: Math.max(0, limit - used),
      ...(observedAt ? { observedAt } : {})
    };
  }
  if (provider === "XMLSTOCK" && isRecord(providerMeta.account)) {
    const account = providerMeta.account;
    const remaining = nonNegativeSafeInteger(account.requestLimit);
    const frozenRemaining = nonNegativeSafeInteger(account.frozenRequestLimit);
    const usedToday = nonNegativeSafeInteger(account.usedToday);
    const usedMonth = nonNegativeSafeInteger(account.usedMonth);
    const tariffDaysRemaining = nonNegativeSafeInteger(
      account.tariffDaysRemaining
    );
    const amount = decimalString(account.balance);
    const frozenAmount = decimalString(account.frozenBalance);
    if (remaining === undefined || amount === undefined) {
      return { status: "NOT_AVAILABLE" };
    }
    return {
      status: "AVAILABLE",
      unit: "XMLSTOCK_REQUESTS",
      remaining,
      balance: {
        amount,
        currency: "RUB",
        ...(frozenAmount === undefined ? {} : { frozenAmount })
      },
      ...(frozenRemaining === undefined ? {} : { frozenRemaining }),
      ...(usedToday === undefined ? {} : { usedToday }),
      ...(usedMonth === undefined ? {} : { usedMonth }),
      ...(tariffDaysRemaining === undefined
        ? {}
        : { tariffDaysRemaining }),
      ...(observedAt ? { observedAt } : {})
    };
  }
  return { status: "NOT_AVAILABLE" };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function decimalString(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+(?:\.\d{1,8})?$/u.test(value)
    ? value
    : undefined;
}

function providerValue(value: string): IntegrationProvider {
  if (!["XMLSTOCK", "ARSENKIN", "KEYS_SO"].includes(value)) {
    throw new Error("Unsupported integration provider in credential storage");
  }
  return value as IntegrationProvider;
}

function displayHint(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}

function versionConflict(): ConflictException {
  return new ConflictException("Credential version conflict");
}

function idempotencyConflict(): ConflictException {
  return new ConflictException(
    "Idempotency key was already used for another credential request"
  );
}

function platformAlreadyEnabled(): ConflictException {
  return new ConflictException(
    "Platform credential is already enabled for this provider"
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
