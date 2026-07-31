import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 2_048;
const PURPOSE_PATTERN = /^[a-z0-9._:-]{1,160}$/u;

@Injectable()
export class BillingPiiService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public seal(value: string, purpose: string): string {
    this.assertPurpose(purpose);
    const plaintext = Buffer.from(value, "utf8");
    if (
      plaintext.length === 0 ||
      plaintext.length > MAX_PLAINTEXT_BYTES
    ) {
      throw new Error("Billing PII value is outside the supported size");
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(this.aad(purpose));
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);
    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url")
    ].join(".");
  }

  public open(value: string, purpose: string): string {
    this.assertPurpose(purpose);
    const [version, iv, tag, encrypted, extra] = value.split(".");
    if (
      version !== VERSION ||
      !iv ||
      !tag ||
      !encrypted ||
      extra !== undefined
    ) {
      throw new Error("Invalid encrypted billing PII");
    }
    try {
      const ivBytes = Buffer.from(iv, "base64url");
      const tagBytes = Buffer.from(tag, "base64url");
      const encryptedBytes = Buffer.from(encrypted, "base64url");
      if (
        ivBytes.length !== IV_BYTES ||
        tagBytes.length !== TAG_BYTES ||
        encryptedBytes.length === 0 ||
        encryptedBytes.length > MAX_PLAINTEXT_BYTES
      ) {
        throw new Error("invalid envelope");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(),
        ivBytes
      );
      decipher.setAAD(this.aad(purpose));
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([
        decipher.update(encryptedBytes),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new Error("Invalid encrypted billing PII");
    }
  }

  private key(): Buffer {
    const configured = this.config.auth.dataEncryptionKey;
    if (configured) return Buffer.from(configured, "base64url");
    return createHash("sha256")
      .update(
        this.config.auth.passwordPepper ??
          "development-only-billing-pii-key",
        "utf8"
      )
      .digest();
  }

  private aad(purpose: string): Buffer {
    return Buffer.from(`billing-pii:${VERSION}:${purpose}`, "utf8");
  }

  private assertPurpose(purpose: string): void {
    if (!PURPOSE_PATTERN.test(purpose)) {
      throw new Error("Invalid billing PII purpose");
    }
  }
}
