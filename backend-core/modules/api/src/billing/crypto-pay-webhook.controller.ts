import { Controller, ForbiddenException, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { BillingService } from "./billing.service.js";
import { CryptoPayClient } from "./crypto-pay.client.js";
import { cryptoPayRawBody } from "./crypto-pay-raw-body.js";

@Controller("api/v1/billing/providers/crypto-pay")
export class CryptoPayWebhookController {
  public constructor(private readonly cryptoPay: CryptoPayClient, private readonly billing: BillingService) {}
  @Post("webhook")
  @HttpCode(200)
  public async webhook(@Req() request: FastifyRequest): Promise<{ received: true }> {
    const raw = cryptoPayRawBody(request);
    const signature = request.headers["crypto-pay-api-signature"];
    let verified: ReturnType<CryptoPayClient["verifyWebhook"]>;
    try {
      if (!raw || typeof signature !== "string") throw new Error("Webhook signature missing");
      verified = this.cryptoPay.verifyWebhook(raw, signature);
    } catch { throw new ForbiddenException("Invalid Crypto Pay webhook"); }
    await this.billing.processWebhook({
      provider: "CRYPTO_PAY", event: "invoice_paid", objectType: "payment",
      objectId: verified.invoiceId, objectStatus: "succeeded",
      fingerprint: verified.fingerprint,
      // Semantic identity is stable across redelivery request_date/update metadata.
      payloadHash: new Uint8Array(Buffer.from(verified.fingerprint, "hex"))
    }, request.ip, true);
    return { received: true };
  }
}
