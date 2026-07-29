export interface IdempotentCommand {
  readonly payloadSignature: string;
  readonly key: string;
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
