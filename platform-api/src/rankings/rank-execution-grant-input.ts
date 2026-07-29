import { BadRequestException } from "@nestjs/common";
import {
  internalIssueRankExecutionGrantInput,
  type InternalIssueRankExecutionGrantInputV1
} from "@seo-platform/contracts";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,180}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface RankExecutionGrantHeaderRequest {
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly raw?: {
    readonly rawHeaders?: readonly string[];
  };
}

export interface RankExecutionGrantTrustedHeaders {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export function issueRankExecutionGrantInput(
  value: unknown
): InternalIssueRankExecutionGrantInputV1 {
  try {
    return internalIssueRankExecutionGrantInput(value);
  } catch {
    throw new BadRequestException(
      "Invalid rank execution grant request"
    );
  }
}

export function requiredRankExecutionGrantIdempotencyKey(
  value: unknown
): string {
  if (
    typeof value !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new BadRequestException(
      "A stable rank execution grant Idempotency-Key is required"
    );
  }
  return value;
}

export function requiredRankExecutionGrantHeaders(
  request: RankExecutionGrantHeaderRequest
): RankExecutionGrantTrustedHeaders {
  return {
    requestId: requiredRequestId(
      rankExecutionGrantSingleHeader(request, "x-request-id")
    ),
    workspaceId: requiredTrustedUuid(
      rankExecutionGrantSingleHeader(request, "x-workspace-id"),
      "X-Workspace-Id"
    ),
    projectId: requiredTrustedUuid(
      rankExecutionGrantSingleHeader(request, "x-project-id"),
      "X-Project-Id"
    ),
    actorId: requiredTrustedUuid(
      rankExecutionGrantSingleHeader(request, "x-actor-id"),
      "X-Actor-Id"
    ),
    idempotencyKey: requiredRankExecutionGrantIdempotencyKey(
      rankExecutionGrantSingleHeader(request, "idempotency-key")
    )
  };
}

/**
 * Reads one exact HTTP header. Fastify exposes duplicate custom headers as a
 * joined string, so the original raw header list is checked when available.
 */
export function rankExecutionGrantSingleHeader(
  request: RankExecutionGrantHeaderRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string") return undefined;

  const rawHeaders = request.raw?.rawHeaders;
  if (rawHeaders !== undefined) {
    if (rawHeaders.length % 2 !== 0) return undefined;
    let matches = 0;
    let rawValue: string | undefined;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === name) {
        matches += 1;
        rawValue = rawHeaders[index + 1];
      }
    }
    if (matches !== 1 || rawValue !== value) return undefined;
  }
  return value;
}

function requiredRequestId(value: string | undefined): string {
  if (!value || !REQUEST_ID_PATTERN.test(value)) {
    throw new BadRequestException(
      "A single bounded X-Request-Id header is required"
    );
  }
  return value;
}

function requiredTrustedUuid(
  value: string | undefined,
  name: string
): string {
  if (!value || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(
      `A single valid ${name} header is required`
    );
  }
  return value.toLowerCase();
}
