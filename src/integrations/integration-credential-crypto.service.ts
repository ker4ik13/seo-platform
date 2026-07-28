import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes
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
    if (!this.config.integrationCredentials.enabled) {
      throw encryptionUnavailable();
    }
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
      return credentialSecret(JSON.parse(plaintext) as unknown);
    } catch {
      throw encryptionUnavailable();
    } finally {
      dataKey?.fill(0);
    }
  }

  public requestFingerprint(
    input: IntegrationCredentialRequestFingerprintInput,
    keyVersion?: number
  ): IntegrationCredentialRequestFingerprint {
    if (!this.config.integrationCredentials.enabled) {
      throw encryptionUnavailable();
    }
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
          accountIdentifier: input.accountIdentifier ?? null
        }),
        "utf8"
      )
        .digest(),
      keyVersion: fingerprintKey.version
    };
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
    if (!this.config.integrationCredentials.enabled) {
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
      typeof value.accountIdentifier !== "string")
  ) {
    throw encryptionUnavailable();
  }
  return {
    apiKey: value.apiKey,
    ...("accountIdentifier" in value &&
    typeof value.accountIdentifier === "string"
      ? { accountIdentifier: value.accountIdentifier }
      : {})
  };
}

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

function encryptionUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Integration credential encryption is unavailable"
  );
}
