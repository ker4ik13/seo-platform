import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { DeliveryAuthorizationGuard } from "./delivery-authorization.guard.js";

const token = "w".repeat(32);

test("accepts only the dedicated Realtime delivery token with no-store", () => {
  const guard = new DeliveryAuthorizationGuard(loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: token
  }));
  const accepted = context(token);
  assert.equal(guard.canActivate(accepted.value), true);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.throws(
    () => guard.canActivate(context("n".repeat(32)).value),
    UnauthorizedException
  );
});

test("fails closed for absent, duplicate or unconfigured credentials", () => {
  const configured = new DeliveryAuthorizationGuard(loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: token
  }));
  assert.throws(
    () => configured.canActivate(context(undefined).value),
    UnauthorizedException
  );
  assert.throws(
    () => configured.canActivate(context(token, [
      "X-Notification-Delivery-Token",
      token,
      "x-notification-delivery-token",
      token
    ]).value),
    UnauthorizedException
  );
  const absent = context(token);
  assert.throws(
    () => new DeliveryAuthorizationGuard(loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })).canActivate(absent.value),
    ServiceUnavailableException
  );
  assert.equal(absent.headers.get("cache-control"), "no-store");
});

function context(
  provided: string | undefined,
  rawHeaders?: readonly string[]
): { readonly value: ExecutionContext; readonly headers: Map<string, string> } {
  const responseHeaders = new Map<string, string>();
  return {
    headers: responseHeaders,
    value: {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: provided
            ? { "x-notification-delivery-token": provided }
            : {},
          ...(rawHeaders ? { raw: { rawHeaders } } : {})
        }),
        getResponse: () => ({
          header: (name: string, value: string) => {
            responseHeaders.set(name.toLowerCase(), value);
          }
        })
      })
    } as unknown as ExecutionContext
  };
}
