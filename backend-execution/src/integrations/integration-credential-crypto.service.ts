import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export interface IntegrationCredentialSecret {
  readonly apiKey: string;
  readonly accountIdentifier?: string;
  /** Opaque HMAC-derived UUID. It is safe for Redis keys, but never logged. */
  readonly rateLimitScopeId?: string;
  readonly platformPool?: readonly PlatformCredentialPoolEntry[];
}

export interface PlatformCredentialPoolEntry {
  readonly id: string;
  readonly apiKey: string;
  readonly accountIdentifier?: string;
}

export interface PlatformCredentialMaterial {
  readonly apiKey: string;
  readonly accountIdentifier?: string;
}

export interface EncryptedIntegrationCredential {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
  readonly encryptedDataKey: Buffer;
  readonly dataKeyNonce: Buffer;
  readonly dataKeyAuthTag: Buffer;
  readonly keyVersion: number;
}

export interface IntegrationCredentialRequestFingerprintInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly provider: IntegrationProvider;
  readonly label: string;
  readonly apiKey: string;
  readonly accountIdentifier?: string;
  readonly platformPool?: readonly PlatformCredentialMaterial[];
}

export interface IntegrationCredentialRequestFingerprint {
  readonly digest: Buffer;
  readonly keyVersion: number;
}

@Injectable()
export class IntegrationCredentialCryptoService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public encrypt(
    workspaceId: string,
    provider: IntegrationProvider,
    credentialId: string,
    secret: IntegrationCredentialSecret
  ): EncryptedIntegrationCredential {
    this.assertManagementRole();
    const { key: masterKey, version } = this.activeKey();
    const dataKey = randomBytes(32);
    try {
      const payload = encryptBytes(
        dataKey,
        Buffer.from(JSON.stringify(secret), "utf8"),
        payloadAad(workspaceId, provider, credentialId)
      );
      const wrappedKey = encryptBytes(
        masterKey,
        dataKey,
        dataKeyAad(workspaceId, provider, credentialId, version)
      );
      return {
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        authTag: payload.authTag,
        encryptedDataKey: wrappedKey.ciphertext,
        dataKeyNonce: wrappedKey.nonce,
        dataKeyAuthTag: wrappedKey.authTag,
        keyVersion: version
      };
    } finally {
      dataKey.fill(0);
    }
  }

  public decrypt(
    workspaceId: string,
    provider: IntegrationProvider,
    credentialId: string,
    encrypted: EncryptedIntegrationCredential
  ): IntegrationCredentialSecret {
    this.assertExecutionRole();
    const key = this.config.integrationCredentials.keys.get(
      encrypted.keyVersion
    );
    if (!key) throw encryptionUnavailable();
    let dataKey: Buffer | undefined;
    try {
      dataKey = decryptBytes(
        key,
        {
          ciphertext: encrypted.encryptedDataKey,
          nonce: encrypted.dataKeyNonce,
          authTag: encrypted.dataKeyAuthTag
        },
        dataKeyAad(
          workspaceId,
          provider,
          credentialId,
          encrypted.keyVersion
        )
      );
      if (dataKey.length !== 32) throw encryptionUnavailable();
      const plaintext = decryptBytes(
        dataKey,
        {
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag
        },
        payloadAad(workspaceId, provider, credentialId)
      ).toString("utf8");
      const secret = credentialSecret(JSON.parse(plaintext) as unknown);
      if (provider === "XMLSTOCK" && !secret.platformPool && secret.accountIdentifier) {
        return {
          ...secret,
          rateLimitScopeId: xmlStockPhysicalKeyScopeId(
            this.oldestEncryptionKey(),
            secret.accountIdentifier,
            secret.apiKey
          )
        };
      }
      return secret;
    } catch {
      throw encryptionUnavailable();
    } finally {
      dataKey?.fill(0);
    }
  }

  public createKekCanary(
    keyVersion: number
  ): EncryptedIntegrationCredential {
    this.assertManagementRole();
    const masterKey = this.config.integrationCredentials.keys.get(
      keyVersion
    );
    if (!masterKey) throw encryptionUnavailable();
    const dataKey = randomBytes(32);
    try {
      const payload = encryptBytes(
        dataKey,
        kekCanaryPlaintext(keyVersion),
        kekCanaryPayloadAad(keyVersion)
      );
      const wrappedKey = encryptBytes(
        masterKey,
        dataKey,
        kekCanaryDataKeyAad(keyVersion)
      );
      return {
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        authTag: payload.authTag,
        encryptedDataKey: wrappedKey.ciphertext,
        dataKeyNonce: wrappedKey.nonce,
        dataKeyAuthTag: wrappedKey.authTag,
        keyVersion
      };
    } finally {
      dataKey.fill(0);
    }
  }

  public verifyKekCanary(
    encrypted: EncryptedIntegrationCredential
  ): void {
    this.assertCanaryRole();
    const masterKey = this.config.integrationCredentials.keys.get(
      encrypted.keyVersion
    );
    if (!masterKey) throw encryptionUnavailable();
    let dataKey: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      dataKey = decryptBytes(
        masterKey,
        {
          ciphertext: encrypted.encryptedDataKey,
          nonce: encrypted.dataKeyNonce,
          authTag: encrypted.dataKeyAuthTag
        },
        kekCanaryDataKeyAad(encrypted.keyVersion)
      );
      if (dataKey.length !== 32) throw encryptionUnavailable();
      plaintext = decryptBytes(
        dataKey,
        {
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag
        },
        kekCanaryPayloadAad(encrypted.keyVersion)
      );
      const expected = kekCanaryPlaintext(encrypted.keyVersion);
      if (
        plaintext.length !== expected.length ||
        !timingSafeEqual(plaintext, expected)
      ) {
        throw encryptionUnavailable();
      }
    } catch {
      throw encryptionUnavailable();
    } finally {
      dataKey?.fill(0);
      plaintext?.fill(0);
    }
  }

  public requestFingerprint(
    input: IntegrationCredentialRequestFingerprintInput,
    keyVersion?: number
  ): IntegrationCredentialRequestFingerprint {
    this.assertManagementRole();
    const fingerprintKey =
      keyVersion === undefined
        ? this.activeFingerprintKey()
        : {
            key: this.config.integrationCredentials.fingerprintKeys.get(
              keyVersion
            ),
            version: keyVersion
          };
    if (!fingerprintKey.key) throw encryptionUnavailable();
    return {
      digest: createHmac("sha256", fingerprintKey.key)
      .update("seo-platform:integration-credential-request:v1", "utf8")
      .update("\0", "utf8")
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          provider: input.provider,
          label: input.label,
          apiKey: input.apiKey,
          accountIdentifier: input.accountIdentifier ?? null,
          ...(input.platformPool
            ? {
                platformPool: input.platformPool.map((entry) => ({
                  apiKey: entry.apiKey,
                  accountIdentifier: entry.accountIdentifier ?? null
                }))
              }
            : {})
        }),
        "utf8"
      )
        .digest(),
      keyVersion: fingerprintKey.version
    };
  }

  public platformCredentialPoolSecret(
    provider: Extract<IntegrationProvider, "XMLSTOCK" | "ARSENKIN">,
    material: readonly PlatformCredentialMaterial[]
  ): IntegrationCredentialSecret {
    this.assertManagementRole();
    if (material.length < 1 || material.length > 64) {
      throw encryptionUnavailable();
    }
    if (provider === "XMLSTOCK") {
      const accountIdentifiers = material.map(
        (entry) => entry.accountIdentifier
      );
      if (
        accountIdentifiers.some((identifier) => !identifier) ||
        new Set(accountIdentifiers).size !== accountIdentifiers.length
      ) {
        throw encryptionUnavailable();
      }
    }
    const { key } = this.platformPoolFingerprintKey();
    const entries = material.map((entry) => ({
      id: platformPoolEntryId(key, provider, entry),
      apiKey: entry.apiKey,
      ...(entry.accountIdentifier
        ? { accountIdentifier: entry.accountIdentifier }
        : {})
    }));
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw encryptionUnavailable();
    }
    const first = entries[0]!;
    return {
      apiKey: first.apiKey,
      ...(first.accountIdentifier
        ? { accountIdentifier: first.accountIdentifier }
        : {}),
      rateLimitScopeId: first.id,
      platformPool: entries
    };
  }

  public platformCredentialFingerprintKeyVersion(): number {
    this.assertManagementRole();
    return this.platformPoolFingerprintKey().version;
  }

  private activeKey(): { readonly key: Buffer; readonly version: number } {
    if (!this.config.integrationCredentials.enabled) {
      throw encryptionUnavailable();
    }
    const version =
      this.config.integrationCredentials.activeKeyVersion;
    const key =
      version === undefined
        ? undefined
        : this.config.integrationCredentials.keys.get(version);
    if (!key || version === undefined) throw encryptionUnavailable();
    return { key, version };
  }

  private activeFingerprintKey(): {
    readonly key: Buffer;
    readonly version: number;
  } {
    if (
      this.config.integrationCredentials.role !== "MANAGEMENT" &&
      this.config.integrationCredentials.role !== "BOTH"
    ) {
      throw encryptionUnavailable();
    }
    const version =
      this.config.integrationCredentials.activeFingerprintKeyVersion;
    const key =
      version === undefined
        ? undefined
        : this.config.integrationCredentials.fingerprintKeys.get(version);
    if (!key || version === undefined) throw encryptionUnavailable();
    return { key, version };
  }

  private platformPoolFingerprintKey(): {
    readonly key: Buffer;
    readonly version: number;
  } {
    if (
      this.config.integrationCredentials.role !== "MANAGEMENT" &&
      this.config.integrationCredentials.role !== "BOTH"
    ) {
      throw encryptionUnavailable();
    }
    const oldestVersion = [
      ...this.config.integrationCredentials.fingerprintKeys.keys()
    ]
      .sort((left, right) => left - right)[0];
    const key = oldestVersion === undefined
      ? undefined
      : this.config.integrationCredentials.fingerprintKeys.get(oldestVersion);
    if (!key || oldestVersion === undefined) throw encryptionUnavailable();
    return { key, version: oldestVersion };
  }

  private oldestEncryptionKey(): Buffer {
    const oldestVersion = [...this.config.integrationCredentials.keys.keys()]
      .sort((left, right) => left - right)[0];
    const key = oldestVersion === undefined
      ? undefined
      : this.config.integrationCredentials.keys.get(oldestVersion);
    if (!key) throw encryptionUnavailable();
    return key;
  }

  private assertManagementRole(): void {
    if (
      this.config.integrationCredentials.role !== "MANAGEMENT" &&
      this.config.integrationCredentials.role !== "BOTH"
    ) {
      throw encryptionUnavailable();
    }
  }

  private assertExecutionRole(): void {
    if (
      this.config.integrationCredentials.role !== "EXECUTION" &&
      this.config.integrationCredentials.role !== "BOTH"
    ) {
      throw encryptionUnavailable();
    }
  }

  private assertCanaryRole(): void {
    if (
      this.config.integrationCredentials.role !== "MANAGEMENT" &&
      this.config.integrationCredentials.role !== "EXECUTION" &&
      this.config.integrationCredentials.role !== "BOTH"
    ) {
      throw encryptionUnavailable();
    }
  }
}

interface AesGcmPayload {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
}

function encryptBytes(
  key: Buffer,
  plaintext: Uint8Array,
  additionalData: Buffer
): AesGcmPayload {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(additionalData);
  return {
    ciphertext: Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]),
    nonce,
    authTag: cipher.getAuthTag()
  };
}

function decryptBytes(
  key: Buffer,
  encrypted: AesGcmPayload,
  additionalData: Buffer
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(additionalData);
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ]);
}

function credentialSecret(value: unknown): IntegrationCredentialSecret {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("apiKey" in value) ||
    typeof value.apiKey !== "string" ||
    (("accountIdentifier" in value) &&
      value.accountIdentifier !== undefined &&
      typeof value.accountIdentifier !== "string") ||
    (("rateLimitScopeId" in value) &&
      value.rateLimitScopeId !== undefined &&
      (typeof value.rateLimitScopeId !== "string" ||
        !UUID_PATTERN.test(value.rateLimitScopeId)))
  ) {
    throw encryptionUnavailable();
  }
  const base = {
    apiKey: value.apiKey,
    ...("accountIdentifier" in value &&
    typeof value.accountIdentifier === "string"
      ? { accountIdentifier: value.accountIdentifier }
      : {}),
    ...("rateLimitScopeId" in value &&
    typeof value.rateLimitScopeId === "string"
      ? { rateLimitScopeId: value.rateLimitScopeId.toLowerCase() }
      : {})
  };
  if (!("platformPool" in value) || value.platformPool === undefined) {
    return base;
  }
  if (
    !Array.isArray(value.platformPool) ||
    value.platformPool.length < 1 ||
    value.platformPool.length > 64
  ) {
    throw encryptionUnavailable();
  }
  const platformPool = value.platformPool.map(platformPoolEntry);
  if (
    new Set(platformPool.map((entry) => entry.id)).size !==
      platformPool.length ||
    base.rateLimitScopeId !== platformPool[0]?.id ||
    base.apiKey !== platformPool[0]?.apiKey ||
    base.accountIdentifier !== platformPool[0]?.accountIdentifier
  ) {
    throw encryptionUnavailable();
  }
  return { ...base, platformPool };
}

function platformPoolEntry(value: unknown): PlatformCredentialPoolEntry {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    !("apiKey" in value) ||
    typeof value.apiKey !== "string" ||
    ("accountIdentifier" in value &&
      value.accountIdentifier !== undefined &&
      typeof value.accountIdentifier !== "string")
  ) {
    throw encryptionUnavailable();
  }
  const accountIdentifier = "accountIdentifier" in value
    ? value.accountIdentifier
    : undefined;
  return {
    id: value.id.toLowerCase(),
    apiKey: value.apiKey,
    ...(typeof accountIdentifier === "string"
      ? { accountIdentifier }
      : {})
  };
}

function platformPoolEntryId(
  key: Buffer,
  provider: Extract<IntegrationProvider, "XMLSTOCK" | "ARSENKIN">,
  material: PlatformCredentialMaterial
): string {
  const bytes = createHmac("sha256", key)
    .update("seo-platform:platform-provider-pool-entry:v1", "utf8")
    .update("\0", "utf8")
    .update(provider, "utf8")
    .update("\0", "utf8")
    .update(material.accountIdentifier ?? "", "utf8")
    .update("\0", "utf8")
    .update(material.apiKey, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function xmlStockPhysicalKeyScopeId(
  masterKey: Buffer,
  accountIdentifier: string,
  apiKey: string
): string {
  const scopeKey = createHmac("sha256", masterKey)
    .update("seo-platform:xmlstock-physical-key-scope-key@1", "utf8")
    .digest();
  const bytes = createHmac("sha256", scopeKey)
    .update("seo-platform:xmlstock-physical-key@1\0", "utf8")
    .update(accountIdentifier.trim(), "utf8")
    .update("\0", "utf8")
    .update(apiKey, "utf8")
    .digest()
    .subarray(0, 16);
  scopeKey.fill(0);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function payloadAad(
  workspaceId: string,
  provider: IntegrationProvider,
  credentialId: string
): Buffer {
  return Buffer.from(
    `seo-platform:integration-credential:v1:${workspaceId}:${provider}:${credentialId}:payload`,
    "utf8"
  );
}

function dataKeyAad(
  workspaceId: string,
  provider: IntegrationProvider,
  credentialId: string,
  version: number
): Buffer {
  return Buffer.from(
    `seo-platform:integration-credential:v1:${workspaceId}:${provider}:${credentialId}:data-key:${version}`,
    "utf8"
  );
}

function kekCanaryPlaintext(keyVersion: number): Buffer {
  return Buffer.from(
    `seo-platform:integration-credential-kek-canary:v1:${keyVersion}`,
    "utf8"
  );
}

function kekCanaryPayloadAad(keyVersion: number): Buffer {
  return Buffer.from(
    `seo-platform:integration-credential-kek-canary:v1:${keyVersion}:payload`,
    "utf8"
  );
}

function kekCanaryDataKeyAad(keyVersion: number): Buffer {
  return Buffer.from(
    `seo-platform:integration-credential-kek-canary:v1:${keyVersion}:data-key`,
    "utf8"
  );
}

function encryptionUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Integration credential encryption is unavailable"
  );
}
