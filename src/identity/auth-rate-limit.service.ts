import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "./auth-crypto.service.js";

type RateLimitAction =
  | "LOGIN"
  | "REGISTER"
  | "VERIFY"
  | "RESEND"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET";

interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly blockSeconds: number;
}
const policies: Readonly<Record<RateLimitAction, RateLimitPolicy>> = {
  LOGIN: { limit: 10, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  REGISTER: { limit: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  VERIFY: { limit: 20, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  RESEND: { limit: 3, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  PASSWORD_RESET_REQUEST: {
    limit: 3,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60
  },
  PASSWORD_RESET: {
    limit: 10,
    windowSeconds: 15 * 60,
    blockSeconds: 15 * 60
  }
};

interface RateLimitRow {
  readonly counter: number;
  readonly blocked_until: Date | null;
}

@Injectable()
export class AuthRateLimitService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService
  ) {}

  public async consume(
    action: RateLimitAction,
    subjects: readonly string[]
  ): Promise<void> {
    const uniqueSubjects = [...new Set(subjects.filter(Boolean))];
    const policy = policies[action];

    for (const subject of uniqueSubjects) {
      const subjectHash = this.crypto.hashOpaqueToken(
        `rate-limit:${action}:${subject}`
      );
      const rows = await this.prisma.$queryRaw<RateLimitRow[]>`
        INSERT INTO "auth_rate_limit_buckets" (
          "id",
          "action",
          "subject_hash",
          "window_started_at",
          "counter",
          "blocked_until",
          "updated_at"
        )
        VALUES (
          uuidv7(),
          ${action},
          ${subjectHash},
          CURRENT_TIMESTAMP,
          1,
          NULL,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("action", "subject_hash")
        DO UPDATE SET
          "counter" = CASE
            WHEN "auth_rate_limit_buckets"."window_started_at"
              <= CURRENT_TIMESTAMP - make_interval(secs => ${policy.windowSeconds})
            THEN 1
            ELSE "auth_rate_limit_buckets"."counter" + 1
          END,
          "window_started_at" = CASE
            WHEN "auth_rate_limit_buckets"."window_started_at"
              <= CURRENT_TIMESTAMP - make_interval(secs => ${policy.windowSeconds})
            THEN CURRENT_TIMESTAMP
            ELSE "auth_rate_limit_buckets"."window_started_at"
          END,
          "blocked_until" = CASE
            WHEN "auth_rate_limit_buckets"."blocked_until" > CURRENT_TIMESTAMP
            THEN "auth_rate_limit_buckets"."blocked_until"
            WHEN (
              CASE
                WHEN "auth_rate_limit_buckets"."window_started_at"
                  <= CURRENT_TIMESTAMP - make_interval(secs => ${policy.windowSeconds})
                THEN 1
                ELSE "auth_rate_limit_buckets"."counter" + 1
              END
            ) > ${policy.limit}
            THEN CURRENT_TIMESTAMP + make_interval(secs => ${policy.blockSeconds})
            ELSE NULL
          END,
          "updated_at" = CURRENT_TIMESTAMP
        RETURNING "counter", "blocked_until"
      `;

      const result = rows[0];
      if (result?.blocked_until && result.blocked_until > new Date()) {
        throw new DomainError({
          statusCode: 429,
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again later.",
          retryable: true,
          details: {
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (result.blocked_until.getTime() - Date.now()) / 1_000
              )
            )
          }
        });
      }
    }
  }
}
