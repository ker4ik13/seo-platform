import nodemailer, { type Transporter } from "nodemailer";
import type { EmailConfig } from "../config/app-config.js";
import type {
  EmailPort,
  TransactionalEmail
} from "./email.port.js";

export class SmtpEmailAdapter implements EmailPort {
  private readonly transporter: Transporter;

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
      pool: true,
      maxConnections: 3,
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
    await this.transporter.verify();
  }

  public async send(
    message: TransactionalEmail
  ): Promise<{ readonly messageId: string }> {
    const result = await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {})
    });

    return { messageId: result.messageId };
  }
}
