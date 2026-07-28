export interface TransactionalEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface EmailPort {
  isEnabled(): boolean;
  healthCheck(): Promise<void>;
  send(message: TransactionalEmail): Promise<{ readonly messageId: string }>;
}

export const EMAIL = Symbol("EMAIL");
