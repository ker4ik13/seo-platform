import {
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

  public hashOpaqueToken(token: string): string {
    const pepper = this.config.auth.passwordPepper;
    return pepper
      ? createHmac("sha256", pepper).update(token).digest("hex")
      : createHash("sha256").update(token).digest("hex");
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
}
