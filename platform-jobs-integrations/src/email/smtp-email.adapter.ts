import type { OnApplicationShutdown } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailConfig } from "../config/app-config.js";
import type {
  EmailPort,
  TransactionalEmail
} from "./email.port.js";
import { EmailDeliveryError } from "./email.port.js";

export class SmtpEmailAdapter implements EmailPort, OnApplicationShutdown {
  private readonly transporter: Transporter;
  private closed = false;

  public constructor(private readonly config: EmailConfig) {
    if (
      !config.from ||
      !config.host ||
      !config.user ||
      !config.password
    ) {
      throw new Error("Cannot construct SMTP adapter with incomplete config");
    }

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true
      },
      pool: true,
      maxConnections: 3,
      connectionTimeout: config.connectionTimeoutMs,
      greetingTimeout: config.connectionTimeoutMs,
      socketTimeout: config.socketTimeoutMs,
      auth: {
        user: config.user,
        pass: config.password
      }
    });
  }

  public isEnabled(): boolean {
    return true;
  }

  public async healthCheck(): Promise<void> {
    if (this.closed) {
      throw new EmailDeliveryError("SMTP_TRANSPORT_UNAVAILABLE", true);
    }
    await this.transporter.verify();
  }

  public async send(
    message: TransactionalEmail
  ): Promise<{ readonly messageId: string }> {
    if (this.closed) {
      throw new EmailDeliveryError("SMTP_TRANSPORT_UNAVAILABLE", true);
    }
    try {
      await this.transporter.sendMail({
        messageId: message.messageId,
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {})
      });

      return { messageId: message.messageId };
    } catch (error) {
      throw classifySmtpError(error);
    }
  }

  public onApplicationShutdown(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.transporter.close();
    } catch {
      // The pool is already unusable and shutdown must remain bounded.
    }
  }
}

interface SmtpFailure {
  readonly code?: unknown;
  readonly responseCode?: unknown;
  readonly command?: unknown;
}

export function classifySmtpError(error: unknown): EmailDeliveryError {
  const failure =
    typeof error === "object" && error !== null
      ? (error as SmtpFailure)
      : {};
  const code = typeof failure.code === "string" ? failure.code : "";
  const responseCode =
    typeof failure.responseCode === "number"
      ? failure.responseCode
      : undefined;
  const command =
    typeof failure.command === "string"
      ? failure.command.toUpperCase()
      : "";

  if (code === "EAUTH") {
    return new EmailDeliveryError(
      "SMTP_AUTHENTICATION_FAILED",
      false
    );
  }
  if (responseCode !== undefined && responseCode >= 500) {
    return new EmailDeliveryError(
      command === "RCPT TO"
        ? "SMTP_RECIPIENT_REJECTED"
        : "SMTP_CONFIGURATION_INVALID",
      false
    );
  }
  if (responseCode !== undefined && responseCode >= 400) {
    return new EmailDeliveryError(
      "SMTP_TEMPORARY_REJECTION",
      true
    );
  }
  return new EmailDeliveryError(
    "SMTP_TRANSPORT_UNAVAILABLE",
    true
  );
}
