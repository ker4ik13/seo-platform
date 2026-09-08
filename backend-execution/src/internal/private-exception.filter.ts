import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Preserve authored domain errors; never log database/provider payloads. */
@Catch()
export class PrivateExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrivateExceptionFilter.name);
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp(), request = http.getRequest<FastifyRequest>(), reply = http.getResponse<FastifyReply>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus(), response = exception.getResponse();
      void reply.status(status).send(typeof response === "object" ? response : { statusCode: status, message: response });
      return;
    }
    const type = exception instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(exception.name) ? exception.name : "UnknownError";
    this.logger.error({ event: "private_request_failed", exceptionType: type, requestId: request.id });
    void reply.status(500).send({ statusCode: 500, message: "Internal server error", requestId: request.id });
  }
}
