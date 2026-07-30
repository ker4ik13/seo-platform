export interface TransactionalEmail {
  readonly messageId: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export type EmailDeliveryErrorCode =
  | "SMTP_AUTHENTICATION_FAILED"
  | "SMTP_CONFIGURATION_INVALID"
  | "SMTP_RECIPIENT_REJECTED"
  | "SMTP_TEMPORARY_REJECTION"
  | "SMTP_TRANSPORT_UNAVAILABLE";

export class EmailDeliveryError extends Error {
  public constructor(
    public readonly code: EmailDeliveryErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

export interface EmailPort {
  isEnabled(): boolean;
  healthCheck(): Promise<void>;
  send(message: TransactionalEmail): Promise<{ readonly messageId: string }>;
}

export const EMAIL = Symbol("EMAIL");
