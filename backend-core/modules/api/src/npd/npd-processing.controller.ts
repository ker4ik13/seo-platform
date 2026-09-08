import { Body, Controller, Inject, Injectable, Post, ServiceUnavailableException, UnauthorizedException, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { authEmailTokensEqual } from "../auth-email/auth-email-delivery.guard.js";
import { assertUuid } from "../common/identifier.js";
import { inputObject, stringField } from "../common/input.js";
import { NpdProcessingService } from "./npd-processing.service.js";

@Injectable()
export class NpdProcessingGuard implements CanActivate {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  public canActivate(context: ExecutionContext): boolean {
    const config = this.config.billing.npd;
    if (!config?.enabled || !config.apiToken) throw new ServiceUnavailableException("NPD processing is disabled");
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ") || !authEmailTokensEqual(config.apiToken, header.slice(7))) throw new UnauthorizedException();
    return true;
  }
}
@Controller("internal/v1/billing/npd-processing")
@UseGuards(NpdProcessingGuard)
export class NpdProcessingController {
  public constructor(private readonly processing: NpdProcessingService) {}
  @Post("claim") public async claim() { return { data: await this.processing.claim() }; }
  @Post("start") public async start(@Body() body: unknown) { const input = scope(body); await this.processing.start(input.receiptId, input.leaseToken); return { data: { accepted: true } }; }
  @Post("complete") public async complete(@Body() body: unknown) { const input = inputObject(body); await this.processing.complete({ ...scope(input), officialReceiptId: stringField(input, "officialReceiptId", { min: 5, max: 128 }), officialReceiptUrl: stringField(input, "officialReceiptUrl", { min: 10, max: 512 }) }); return { data: { accepted: true } }; }
  @Post("fail") public async fail(@Body() body: unknown) { const input = inputObject(body); const binding = scope(input); await this.processing.fail(binding.receiptId, binding.leaseToken, input.started === true); return { data: { accepted: true } }; }
}
function scope(body: unknown) { const input = inputObject(body); return { receiptId: assertUuid(String(input.receiptId), "receiptId"), leaseToken: assertUuid(String(input.leaseToken), "leaseToken") }; }
