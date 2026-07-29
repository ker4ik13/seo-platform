import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import {
  webPushRenameInput,
  webPushUpsertInput
} from "./web-push-input.js";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const input = {
  userId: "01900000-0000-7000-8000-000000000001",
  sessionFamilyId: "01900000-0000-7000-8000-000000000002",
  browser: "CHROME",
  platform: "MACOS",
  label: "Рабочий Mac",
  intent: "ENABLE",
  applicationServerKeyVersion: 1,
  subscription: {
    endpoint: "https://push.example.test/send/opaque",
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 3).toString("base64url")
    }
  }
} as const;
const config = loadAppConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
  WEB_PUSH_ENDPOINT_ORIGINS: "https://push.example.test"
});

test("accepts an exact validated internal Web Push registration", () => {
  assert.deepEqual(webPushUpsertInput(input, config), input);
  assert.deepEqual(
    webPushRenameInput({
      userId: input.userId,
      version: 2,
      label: "Телефон"
    }),
    {
      userId: input.userId,
      version: 2,
      label: "Телефон"
    }
  );
});

test("rejects unknown trusted fields and SSRF-shaped endpoints", () => {
  assert.throws(
    () => webPushUpsertInput({ ...input, status: "ACTIVE" }, config),
    BadRequestException
  );
  assert.throws(
    () =>
      webPushUpsertInput(
        {
          ...input,
          subscription: {
            ...input.subscription,
            endpoint: "https://127.0.0.1/send"
          }
        },
        config
    ),
    BadRequestException
  );
  assert.throws(
    () =>
      webPushUpsertInput(
        {
          ...input,
          subscription: {
            ...input.subscription,
            endpoint: "https://PUSH.example.test/send/opaque"
          }
        },
        config
      ),
    BadRequestException
  );
});

test("rejects malformed browser key material and unsafe labels", () => {
  assert.throws(
    () =>
      webPushUpsertInput(
        {
          ...input,
          subscription: {
            ...input.subscription,
            keys: {
              ...input.subscription.keys,
              auth: Buffer.alloc(15).toString("base64url")
            }
          }
        },
        config
      ),
    BadRequestException
  );
  assert.throws(
    () => webPushRenameInput({
      userId: input.userId,
      version: 1,
      label: "unsafe\u202etext"
    }),
    BadRequestException
  );
});
