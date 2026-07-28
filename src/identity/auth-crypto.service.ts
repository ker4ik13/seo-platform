import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  argon2id,
  hash as argonHash,
  verify as argonVerify
} from "argon2";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";

const PASSWORD_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32
} as const;
const MFA_SECRET_AAD = Buffer.from("mfa-secret:v1", "utf8");

@Injectable()
export class AuthCryptoService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public randomToken(): string {
    return randomBytes(32).toString("base64url");
  }

  public randomFamilyId(): string {
    return randomUUID();
  }

  public emailVerificationToken(
    tokenId: string,
    userId: string,
    expiresAt: Date
  ): string {
    const key =
      this.config.auth.passwordPepper ??
      "development-only-verification-signing-key";
    const signature = createHmac("sha256", key)
      .update(
        `email-verification:${tokenId}:${userId}:${expiresAt.toISOString()}`
      )
      .digest("base64url");
    return `${tokenId}.${signature}`;
  }

  public workspaceInvitationToken(
    inviteId: string,
    workspaceId: string,
    emailNormalized: string,
    expiresAt: Date
  ): string {
    const key =
      this.config.auth.passwordPepper ??
      "development-only-invitation-signing-key";
    const signature = createHmac("sha256", key)
      .update(
        [
          "workspace-invitation",
          inviteId,
          workspaceId,
          emailNormalized,
          expiresAt.toISOString()
        ].join(":")
      )
      .digest("base64url");
    return `${inviteId}.${signature}`;
  }

  public passwordResetToken(
    tokenId: string,
    userId: string,
    expiresAt: Date
  ): string {
    const key =
      this.config.auth.passwordPepper ??
      "development-only-password-reset-signing-key";
    const signature = createHmac("sha256", key)
      .update(`password-reset:${tokenId}:${userId}:${expiresAt.toISOString()}`)
      .digest("base64url");
    return `${tokenId}.${signature}`;
  }

  public hashOpaqueToken(token: string): string {
    const pepper = this.config.auth.passwordPepper;
    return pepper
      ? createHmac("sha256", pepper).update(token).digest("hex")
      : createHash("sha256").update(token).digest("hex");
  }

  public encryptMfaSecret(secret: string): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.dataEncryptionKey(),
      initializationVector
    );
    cipher.setAAD(MFA_SECRET_AAD);
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final()
    ]);
    const authenticationTag = cipher.getAuthTag();
    return [
      "v1",
      initializationVector.toString("base64url"),
      authenticationTag.toString("base64url"),
      encrypted.toString("base64url")
    ].join(".");
  }

  public decryptMfaSecret(value: string): string {
    const [version, ivValue, tagValue, encryptedValue, extra] =
      value.split(".");
    if (
      version !== "v1" ||
      !ivValue ||
      !tagValue ||
      !encryptedValue ||
      extra !== undefined
    ) {
      throw new Error("Invalid encrypted MFA secret");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.dataEncryptionKey(),
        Buffer.from(ivValue, "base64url")
      );
      decipher.setAAD(MFA_SECRET_AAD);
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64url")),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new Error("Invalid encrypted MFA secret");
    }
  }

  public tokensEqual(left: string, right: string): boolean {
    const leftHash = createHash("sha256").update(left).digest();
    const rightHash = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  }

  public async hashPassword(password: string): Promise<string> {
    return argonHash(this.passwordMaterial(password), PASSWORD_OPTIONS);
  }

  public async verifyPassword(
    password: string,
    storedHash: string | null | undefined
  ): Promise<boolean> {
    if (!storedHash) {
      await this.hashPassword(password);
      return false;
    }

    try {
      return await argonVerify(storedHash, this.passwordMaterial(password));
    } catch {
      return false;
    }
  }

  private passwordMaterial(password: string): string {
    return `${password}\u0000${this.config.auth.passwordPepper ?? ""}`;
  }

  private dataEncryptionKey(): Buffer {
    if (this.config.auth.dataEncryptionKey) {
      return Buffer.from(this.config.auth.dataEncryptionKey, "base64url");
    }
    return createHash("sha256")
      .update(
        this.config.auth.passwordPepper ??
          "development-only-data-encryption-key"
      )
      .digest();
  }
}
