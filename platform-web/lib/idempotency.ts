export interface IdempotentCommand {
  readonly payloadSignature: string;
  readonly key: string;
}

const IDEMPOTENCY_SCOPE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/u;

export function browserIdempotencyKey(
  scope: string,
  createId: () => string = () => globalThis.crypto.randomUUID()
): string {
  if (!IDEMPOTENCY_SCOPE_PATTERN.test(scope)) {
    throw new Error("Invalid idempotency scope");
  }

  const key = `${scope}:${createId()}`;
  if (key.length > 180 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    throw new Error("Invalid idempotency key");
  }
  return key;
}

export function stableIdempotencyCommand(
  current: IdempotentCommand | undefined,
  payloadSignature: string,
  createKey: () => string
): IdempotentCommand {
  return current?.payloadSignature === payloadSignature
    ? current
    : {
        payloadSignature,
        key: createKey()
      };
}
