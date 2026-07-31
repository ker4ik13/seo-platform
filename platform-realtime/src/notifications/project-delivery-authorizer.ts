import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  ApiResponse,
  InternalAuthorizeProjectNotificationDeliveryInput,
  InternalAuthorizeProjectNotificationDeliveryResult
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export interface ProjectDeliveryAuthorizer {
  authorize(
    input: InternalAuthorizeProjectNotificationDeliveryInput
  ): Promise<InternalAuthorizeProjectNotificationDeliveryResult>;
}

export const PROJECT_DELIVERY_AUTHORIZER = Symbol(
  "PROJECT_DELIVERY_AUTHORIZER"
);

@Injectable()
export class PlatformProjectDeliveryAuthorizer
  implements ProjectDeliveryAuthorizer
{
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async authorize(
    input: InternalAuthorizeProjectNotificationDeliveryInput
  ): Promise<InternalAuthorizeProjectNotificationDeliveryResult> {
    const baseUrl = this.config.webPush.platformApiUrl;
    const token = this.config.webPush.deliveryAuthorizationToken;
    if (!baseUrl || !token) {
      throw new Error("Project delivery authorization is not configured");
    }
    const response = await fetch(
      `${baseUrl}/internal/v1/projects/${input.projectId}/notification-deliveries/authorize`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(
          this.config.webPush.deliveryAuthorizationTimeoutMs
        ),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-notification-delivery-token": token,
          "x-request-id": randomUUID()
        },
        body: JSON.stringify(input)
      }
    );
    const body = await boundedResponseText(response, 8_192);
    if (!response.ok) {
      throw new Error("Project delivery authorization is unavailable");
    }
    return authorizationResult(body);
  }
}

function authorizationResult(
  body: string
): InternalAuthorizeProjectNotificationDeliveryResult {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Invalid project delivery authorization response");
  }
  if (!exactRecord(value, ["data", "meta"])) invalidResponse();
  const envelope = value as ApiResponse<unknown>;
  if (!exactRecord(envelope.meta, ["requestId"])) invalidResponse();
  const requestId = envelope.meta.requestId;
  if (
    typeof requestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(requestId)
  ) {
    invalidResponse();
  }
  if (!exactRecord(envelope.data, ["authorized", "reason"])) {
    invalidResponse();
  }
  const data = envelope.data as Readonly<Record<string, unknown>>;
  if (
    typeof data.authorized !== "boolean" ||
    !["AUTHORIZED", "ACCESS_REVOKED", "SCOPE_CHANGED"].includes(
      String(data.reason)
    ) ||
    (data.authorized && data.reason !== "AUTHORIZED") ||
    (!data.authorized && data.reason === "AUTHORIZED")
  ) {
    invalidResponse();
  }
  return data as unknown as InternalAuthorizeProjectNotificationDeliveryResult;
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error("Project delivery authorization response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    received += result.value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new Error("Project delivery authorization response is too large");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, received).toString("utf8");
}

function exactRecord(value: unknown, keys: readonly string[]): boolean {
  return Boolean(
    typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      Object.keys(value).every((key) => keys.includes(key))
  );
}

function invalidResponse(): never {
  throw new Error("Invalid project delivery authorization response");
}
