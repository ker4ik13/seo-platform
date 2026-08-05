import { Injectable } from "@nestjs/common";
import webPush from "web-push";
import type {
  PushSubscription,
  RequestOptions,
  SendResult
} from "web-push";

export interface WebPushTransportRequest {
  readonly subscription: PushSubscription;
  readonly payload: string;
  readonly options: RequestOptions;
}

export interface WebPushTransport {
  send(request: WebPushTransportRequest): Promise<SendResult>;
}

export const WEB_PUSH_TRANSPORT = Symbol("WEB_PUSH_TRANSPORT");

@Injectable()
export class NodeWebPushTransport implements WebPushTransport {
  public send(request: WebPushTransportRequest): Promise<SendResult> {
    return webPush.sendNotification(
      request.subscription,
      request.payload,
      request.options
    );
  }
}
