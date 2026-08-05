import type {
  EmailPort,
  TransactionalEmail
} from "./email.port.js";

export class DisabledEmailAdapter implements EmailPort {
  public isEnabled(): boolean {
    return false;
  }

  public async healthCheck(): Promise<void> {}

  public send(
    _message: TransactionalEmail
  ): Promise<{ readonly messageId: string }> {
    return Promise.reject(new Error("Transactional email is disabled"));
  }
}
