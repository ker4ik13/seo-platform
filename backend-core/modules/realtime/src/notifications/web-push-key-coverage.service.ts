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
  type OnApplicationBootstrap
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";

const CANARY_PLAINTEXT = Buffer.from(
  "seo-platform:web-push:key-canary:v1",
  "utf8"
);

@Injectable()
export class WebPushKeyCoverageService
  implements OnApplicationBootstrap
{
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    const versions = await this.prisma.webPushSubscription.findMany({
      where: { status: "ACTIVE" },
      distinct: ["encryptionKeyVersion", "fingerprintKeyVersion"],
      select: {
        encryptionKeyVersion: true,
        fingerprintKeyVersion: true
      }
    });
    for (const version of versions) {
      if (
        version.encryptionKeyVersion === null ||
        version.fingerprintKeyVersion === null ||
        !this.config.webPush.subscriptionKeys.has(
          version.encryptionKeyVersion
        ) ||
        !this.config.webPush.fingerprintKeys.has(
          version.fingerprintKeyVersion
        )
      ) {
        throw new Error(
          "Web Push keyring does not cover every active subscription"
        );
      }
    }
    for (const [version, key] of this.config.webPush.subscriptionKeys) {
      await this.verifyEncryptionKey(version, key);
    }
    for (const [version, key] of this.config.webPush.fingerprintKeys) {
      await this.verifyFingerprintKey(version, key);
    }
  }

  private async verifyEncryptionKey(
    version: number,
    key: Buffer
  ): Promise<void> {
    let canary = await this.prisma.webPushEncryptionKeyCanary.findUnique({
      where: { keyVersion: version }
    });
    if (!canary) {
      if (this.config.serviceRole === "WEB_PUSH_WORKER") missingCanary();
      const encrypted = encryptCanary(version, key);
      try {
        canary = await this.prisma.webPushEncryptionKeyCanary.create({
          data: { keyVersion: version, ...encrypted }
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        canary = await this.prisma.webPushEncryptionKeyCanary.findUnique({
          where: { keyVersion: version }
        });
      }
    }
    if (!canary || !decryptsCanary(version, key, canary)) {
      throw new Error("Web Push encryption key canary verification failed");
    }
  }

  private async verifyFingerprintKey(
    version: number,
    key: Buffer
  ): Promise<void> {
    const expected = fingerprintCanary(version, key);
    let canary = await this.prisma.webPushFingerprintKeyCanary.findUnique({
      where: { keyVersion: version }
    });
    if (!canary) {
      if (this.config.serviceRole === "WEB_PUSH_WORKER") missingCanary();
      try {
        canary = await this.prisma.webPushFingerprintKeyCanary.create({
          data: {
            keyVersion: version,
            digest: Uint8Array.from(expected)
          }
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        canary = await this.prisma.webPushFingerprintKeyCanary.findUnique({
          where: { keyVersion: version }
        });
      }
    }
    const actual = canary ? Buffer.from(canary.digest) : undefined;
    if (!actual || actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)) {
      throw new Error("Web Push fingerprint key canary verification failed");
    }
  }
}

function encryptCanary(version: number, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(canaryAad(version));
  return {
    ciphertext: Buffer.concat([
      cipher.update(CANARY_PLAINTEXT),
      cipher.final()
    ]),
    nonce,
    authTag: cipher.getAuthTag()
  };
}

function decryptsCanary(
  version: number,
  key: Buffer,
  canary: {
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly authTag: Uint8Array;
  }
): boolean {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, canary.nonce);
    decipher.setAAD(canaryAad(version));
    decipher.setAuthTag(Buffer.from(canary.authTag));
    const plaintext = Buffer.concat([
      decipher.update(canary.ciphertext),
      decipher.final()
    ]);
    return plaintext.length === CANARY_PLAINTEXT.length &&
      timingSafeEqual(plaintext, CANARY_PLAINTEXT);
  } catch {
    return false;
  }
}

function fingerprintCanary(version: number, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(canaryAad(version))
    .update(CANARY_PLAINTEXT)
    .digest();
}

function canaryAad(version: number): Buffer {
  return Buffer.from(
    `seo-platform:web-push:key-canary:v1:${version}`,
    "utf8"
  );
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
  );
}

function missingCanary(): never {
  throw new Error("Web Push key canary is missing for the sender role");
}
