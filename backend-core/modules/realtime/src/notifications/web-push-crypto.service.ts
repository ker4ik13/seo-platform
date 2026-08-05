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
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export interface WebPushMaterial {
  readonly endpoint: string;
  readonly expirationTime: number | null;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

export interface WebPushFingerprint {
  readonly digest: Buffer;
  readonly keyVersion: number;
}

export interface EncryptedWebPushMaterial {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
  readonly encryptionKeyVersion: number;
  readonly endpointFingerprint: Buffer;
  readonly materialFingerprint: Buffer;
  readonly fingerprintKeyVersion: number;
}

export interface StoredEncryptedWebPushMaterial {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly encryptionKeyVersion: number;
  readonly endpointFingerprint: Uint8Array;
  readonly fingerprintKeyVersion: number;
}

interface WebPushCryptoContext {
  readonly userId: string;
  readonly installationId: string;
  readonly sessionFamilyId: string;
  readonly applicationServerKeyVersion: number;
}

@Injectable()
export class WebPushCryptoService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public encrypt(
    context: WebPushCryptoContext,
    material: WebPushMaterial
  ): EncryptedWebPushMaterial {
    const encryption = this.activeEncryptionKey();
    const fingerprint = this.activeFingerprintKey();
    const endpointFingerprint = endpointDigest(
      fingerprint.key,
      material.endpoint
    );
    const materialFingerprint = materialDigest(
      fingerprint.key,
      material
    );
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      encryption.key,
      nonce
    );
    cipher.setAAD(
      materialAad(
        context,
        endpointFingerprint,
        encryption.version,
        fingerprint.version
      )
    );
    const plaintext = Buffer.from(JSON.stringify(material), "utf8");
    try {
      return {
        ciphertext: Buffer.concat([
          cipher.update(plaintext),
          cipher.final()
        ]),
        nonce,
        authTag: cipher.getAuthTag(),
        encryptionKeyVersion: encryption.version,
        endpointFingerprint,
        materialFingerprint,
        fingerprintKeyVersion: fingerprint.version
      };
    } finally {
      plaintext.fill(0);
    }
  }

  public decrypt(
    context: WebPushCryptoContext,
    encrypted: StoredEncryptedWebPushMaterial
  ): WebPushMaterial {
    const key = this.config.webPush.subscriptionKeys.get(
      encrypted.encryptionKeyVersion
    );
    if (!key) throw cryptoUnavailable();
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        encrypted.nonce
      );
      decipher.setAAD(
        materialAad(
          context,
          Buffer.from(encrypted.endpointFingerprint),
          encrypted.encryptionKeyVersion,
          encrypted.fingerprintKeyVersion
        )
      );
      decipher.setAuthTag(Buffer.from(encrypted.authTag));
      const plaintext = Buffer.concat([
        decipher.update(encrypted.ciphertext),
        decipher.final()
      ]);
      try {
        return webPushMaterial(
          JSON.parse(plaintext.toString("utf8")) as unknown
        );
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw cryptoUnavailable();
    }
  }

  public endpointFingerprints(endpoint: string): readonly WebPushFingerprint[] {
    if (this.config.webPush.fingerprintKeys.size === 0) {
      throw cryptoUnavailable();
    }
    return [...this.config.webPush.fingerprintKeys.entries()].map(
      ([keyVersion, key]) => ({
        digest: endpointDigest(key, endpoint),
        keyVersion
      })
    );
  }

  public materialFingerprint(
    material: WebPushMaterial,
    keyVersion: number
  ): WebPushFingerprint {
    const key = this.config.webPush.fingerprintKeys.get(keyVersion);
    if (!key) throw cryptoUnavailable();
    return {
      digest: materialDigest(key, material),
      keyVersion
    };
  }

  private activeEncryptionKey(): {
    readonly key: Buffer;
    readonly version: number;
  } {
    const version = this.config.webPush.activeSubscriptionKeyVersion;
    const key =
      version === undefined
        ? undefined
        : this.config.webPush.subscriptionKeys.get(version);
    if (
      !this.config.webPush.registrationEnabled ||
      version === undefined ||
      !key
    ) {
      throw cryptoUnavailable();
    }
    return { key, version };
  }

  private activeFingerprintKey(): {
    readonly key: Buffer;
    readonly version: number;
  } {
    const version = this.config.webPush.activeFingerprintKeyVersion;
    const key =
      version === undefined
        ? undefined
        : this.config.webPush.fingerprintKeys.get(version);
    if (
      !this.config.webPush.registrationEnabled ||
      version === undefined ||
      !key
    ) {
      throw cryptoUnavailable();
    }
    return { key, version };
  }
}

function endpointDigest(key: Buffer, endpoint: string): Buffer {
  return createHmac("sha256", key)
    .update("seo-platform:web-push:endpoint:v1", "utf8")
    .update("\0", "utf8")
    .update(endpoint, "utf8")
    .digest();
}

function materialDigest(
  key: Buffer,
  material: WebPushMaterial
): Buffer {
  return createHmac("sha256", key)
    .update("seo-platform:web-push:material:v1", "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(material), "utf8")
    .digest();
}

function materialAad(
  context: WebPushCryptoContext,
  endpointFingerprint: Buffer,
  encryptionKeyVersion: number,
  fingerprintKeyVersion: number
): Buffer {
  return Buffer.from(
    [
      "seo-platform:web-push:material:v1",
      context.userId,
      context.installationId,
      context.sessionFamilyId,
      String(context.applicationServerKeyVersion),
      String(encryptionKeyVersion),
      String(fingerprintKeyVersion),
      endpointFingerprint.toString("base64url")
    ].join(":"),
    "utf8"
  );
}

function webPushMaterial(value: unknown): WebPushMaterial {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw cryptoUnavailable();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = input.keys;
  if (
    typeof input.endpoint !== "string" ||
    (input.expirationTime !== null &&
      !Number.isSafeInteger(input.expirationTime)) ||
    typeof keys !== "object" ||
    keys === null ||
    Array.isArray(keys)
  ) {
    throw cryptoUnavailable();
  }
  const keyInput = keys as Readonly<Record<string, unknown>>;
  if (
    typeof keyInput.p256dh !== "string" ||
    typeof keyInput.auth !== "string"
  ) {
    throw cryptoUnavailable();
  }
  return {
    endpoint: input.endpoint,
    expirationTime: input.expirationTime as number | null,
    keys: {
      p256dh: keyInput.p256dh,
      auth: keyInput.auth
    }
  };
}

function cryptoUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "WEB_PUSH_UNAVAILABLE",
    message: "Web Push subscription encryption is unavailable"
  });
}
