import assert from "node:assert/strict";
import test from "node:test";
import type { EmailConfig } from "../config/app-config.js";
import {
  classifySmtpError,
  SmtpEmailAdapter
} from "./smtp-email.adapter.js";

test("classifies SMTP failures into a finite safe retry vocabulary", () => {
  for (const [failure, code, retryable] of [
    [{ code: "EAUTH", response: "secret provider detail" }, "SMTP_AUTHENTICATION_FAILED", false],
    [{ responseCode: 550, command: "RCPT TO", response: "address leaked" }, "SMTP_RECIPIENT_REJECTED", false],
    [{ responseCode: 554, command: "DATA" }, "SMTP_CONFIGURATION_INVALID", false],
    [{ responseCode: 451, command: "DATA" }, "SMTP_TEMPORARY_REJECTION", true],
    [{ code: "ETIMEDOUT" }, "SMTP_TRANSPORT_UNAVAILABLE", true],
    [new Error("private transport detail"), "SMTP_TRANSPORT_UNAVAILABLE", true]
  ] as const) {
    const classified = classifySmtpError(failure);
    assert.equal(classified.code, code);
    assert.equal(classified.retryable, retryable);
    assert.equal(classified.message, code);
    assert.equal(classified.message.includes("secret"), false);
    assert.equal(classified.message.includes("address"), false);
  }
});

test("requires TLS upgrade for submission and closes the pooled transport once", async () => {
  const adapter = new SmtpEmailAdapter(smtpConfig(false));
  const internal = adapter as unknown as {
    readonly transporter: {
      readonly options: {
        readonly requireTLS?: boolean;
        readonly secure?: boolean;
        readonly tls?: {
          readonly minVersion?: string;
          readonly rejectUnauthorized?: boolean;
        };
      };
      close(): void;
    };
  };
  assert.equal(internal.transporter.options.secure, false);
  assert.equal(internal.transporter.options.requireTLS, true);
  assert.deepEqual(internal.transporter.options.tls, {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true
  });

  let closes = 0;
  internal.transporter.close = () => {
    closes += 1;
  };
  adapter.onApplicationShutdown();
  adapter.onApplicationShutdown();
  assert.equal(closes, 1);
  await assert.rejects(
    () =>
      adapter.send({
        messageId: "<auth-email-test@mail.example.test>",
        to: "person@example.test",
        subject: "Test",
        text: "Test"
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "SMTP_TRANSPORT_UNAVAILABLE"
  );

  const directTls = new SmtpEmailAdapter(smtpConfig(true));
  const directInternal = directTls as unknown as {
    readonly transporter: {
      readonly options: { readonly requireTLS?: boolean; readonly secure?: boolean };
    };
  };
  assert.equal(directInternal.transporter.options.secure, true);
  assert.equal(directInternal.transporter.options.requireTLS, false);
  directTls.onApplicationShutdown();
});

function smtpConfig(secure: boolean): EmailConfig {
  return {
    enabled: true,
    from: "jobs@example.test",
    messageIdDomain: "mail.example.test",
    host: "smtp.example.test",
    port: secure ? 465 : 587,
    secure,
    user: "jobs",
    password: "secret",
    connectionTimeoutMs: 10_000,
    socketTimeoutMs: 60_000
  };
}
