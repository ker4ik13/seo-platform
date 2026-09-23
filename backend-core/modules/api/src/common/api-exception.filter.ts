import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter
} from "@nestjs/common";
import type { ApiErrorResponse, ErrorCode } from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "./domain-error.js";

const statusCodes: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "RESOURCE_STATE_CONFLICT",
  412: "VERSION_CONFLICT",
  413: "FILE_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_FAILED",
  428: "VERSION_CONFLICT",
  429: "RATE_LIMITED",
  503: "DEPENDENCY_UNAVAILABLE"
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const requestId = request.id;

    if (exception instanceof DomainError) {
      const response: ApiErrorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          requestId,
          retryable: exception.retryable,
          ...(exception.details ? { details: exception.details } : {}),
          ...(exception.fieldErrors
            ? { fieldErrors: exception.fieldErrors }
            : {})
        }
      };
      void reply.status(exception.statusCode).send(response);
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response: ApiErrorResponse = {
        error: {
          code: statusCodes[statusCode] ?? "INTERNAL_ERROR",
          message:
            statusCode >= 500
              ? "An internal error occurred"
              : exception.message,
          requestId,
          retryable: statusCode >= 500
        }
      };
      void reply.status(statusCode).send(response);
      return;
    }

    const exceptionName =
      exception instanceof Error ? exception.name : typeof exception;
    const diagnostic = safeExceptionDiagnostic(exception);
    this.logger.error(
      `Unhandled ${exceptionName}; requestId=${requestId}${diagnostic}`
    );

    const response: ApiErrorResponse = {
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        requestId,
        retryable: false
      }
    };
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(response);
  }
}

export function safeExceptionDiagnostic(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const error = value as Readonly<Record<string, unknown>>;
  const meta = typeof error.meta === "object" && error.meta !== null
    ? error.meta as Readonly<Record<string, unknown>>
    : undefined;
  const fields: string[] = [];
  const code = safeDiagnosticCode(error.code);
  const databaseCode = safeDiagnosticCode(
    error.originalCode ?? meta?.code
  );
  if (code) fields.push(`code=${code}`);
  if (databaseCode && databaseCode !== code) {
    fields.push(`databaseCode=${databaseCode}`);
  }
  const target = safeDiagnosticTarget(meta?.target);
  if (target) fields.push(`target=${target}`);
  return fields.length > 0 ? `; ${fields.join("; ")}` : "";
}

function safeDiagnosticCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z0-9_]{2,40}$/u.test(value)
    ? value
    : undefined;
}

function safeDiagnosticTarget(value: unknown): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length < 1 ||
    values.length > 8 ||
    values.some(
      (item) =>
        typeof item !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(item)
    )
  ) {
    return undefined;
  }
  return (values as string[]).join(",");
}
