import { timingSafeEqual } from "node:crypto";
import {
  internalIssueRankExecutionGrantInput,
  internalRankExecutionGrantDecision,
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type { Prisma } from "../generated/prisma/client.js";

export interface RankExecutionGrantHashes {
  readonly requestHash: Buffer;
  readonly scopeHash: Buffer;
}

export type RankExecutionGrantDecisionTransition =
  | {
      readonly status: "DENIED";
      readonly decision: InternalRankExecutionGrantDecisionV1;
    }
  | {
      readonly status: "EXPIRED";
      readonly decision: Extract<
        InternalRankExecutionGrantDecisionV1,
        { readonly status: "GRANTED" }
      >;
      readonly expiresAt: Date;
    }
  | {
      readonly status: "GRANTED_PENDING_CONSUME";
      readonly decision: Extract<
        InternalRankExecutionGrantDecisionV1,
        { readonly status: "GRANTED" }
      >;
      readonly expiresAt: Date;
    };

export function rankExecutionGrantAttemptIdempotencyKey(
  jobItemId: string,
  executionAttempt: number
): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      jobItemId
    ) ||
    !Number.isSafeInteger(executionAttempt) ||
    executionAttempt < 1 ||
    executionAttempt > 1_000
  ) {
    throw new TypeError("Invalid rank execution grant attempt identity");
  }
  return `rank-grant:${jobItemId}:${executionAttempt}`;
}

export function rankExecutionGrantHashes(
  input: InternalIssueRankExecutionGrantInputV1
): RankExecutionGrantHashes {
  const request = internalIssueRankExecutionGrantInput(input);
  return {
    requestHash: Buffer.from(
      canonicalJsonSha256(
        rankExecutionGrantRequestHashDomain,
        rankExecutionGrantRequestHashPreimage(request)
      ),
      "hex"
    ),
    scopeHash: Buffer.from(
      canonicalJsonSha256(
        rankExecutionGrantScopeHashDomain,
        rankExecutionGrantScopeHashPreimage(request)
      ),
      "hex"
    )
  };
}

export function rankExecutionGrantRequestJson(
  input: InternalIssueRankExecutionGrantInputV1
): Prisma.InputJsonValue {
  return JSON.parse(
    canonicalizeJson(internalIssueRankExecutionGrantInput(input))
  ) as Prisma.InputJsonValue;
}

export function storedRankExecutionGrantRequest(
  value: unknown
): InternalIssueRankExecutionGrantInputV1 {
  return internalIssueRankExecutionGrantInput(value);
}

export function rankExecutionGrantDecisionJson(
  decision: InternalRankExecutionGrantDecisionV1
): Prisma.InputJsonValue {
  return JSON.parse(
    canonicalizeJson(internalRankExecutionGrantDecision(decision))
  ) as Prisma.InputJsonValue;
}

export function rankExecutionGrantDecisionTransition(
  input: InternalIssueRankExecutionGrantInputV1,
  value: unknown,
  databaseNow: Date
): RankExecutionGrantDecisionTransition {
  if (
    !(databaseNow instanceof Date) ||
    Number.isNaN(databaseNow.getTime())
  ) {
    throw new TypeError("Invalid Jobs database clock");
  }
  const decision = internalRankExecutionGrantDecision(value);
  const hashes = rankExecutionGrantHashes(input);
  if (!hashMatches(decision.requestHash.value, hashes.requestHash)) {
    throw new TypeError("Rank execution grant request hash mismatch");
  }
  const decidedAt = new Date(decision.decidedAt);
  if (decidedAt.getTime() > databaseNow.getTime()) {
    throw new TypeError("Rank execution grant was decided in the future");
  }
  if (decision.status === "DENIED") {
    return { status: "DENIED", decision };
  }
  if (!hashMatches(decision.grant.scopeHash.value, hashes.scopeHash)) {
    throw new TypeError("Rank execution grant scope hash mismatch");
  }
  const expiresAt = new Date(decision.grant.expiresAt);
  return databaseNow.getTime() >= expiresAt.getTime()
    ? { status: "EXPIRED", decision, expiresAt }
    : { status: "GRANTED_PENDING_CONSUME", decision, expiresAt };
}

function hashMatches(hex: string, expected: Buffer): boolean {
  const value = Buffer.from(hex, "hex");
  return (
    value.length === expected.length &&
    value.length === 32 &&
    timingSafeEqual(value, expected)
  );
}
