/** Component-owned recovery state, discarded with its form; never persisted. */
export interface OperationAttempt {
  readonly signature: string;
  readonly key: string;
  quoteId?: string;
  invalidated?: boolean;
}
export function prepareOperationAttempt(current: OperationAttempt | undefined, path: string, body: unknown, source: string, prefix: string): OperationAttempt {
  const signature = JSON.stringify([path, source, body]);
  return current?.signature === signature && !current.invalidated ? current : { signature, key: `${prefix}:${globalThis.crypto.randomUUID()}` };
}
