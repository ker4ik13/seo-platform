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
    this.logger.error(
      `Unhandled ${exceptionName}; requestId=${requestId}`
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
