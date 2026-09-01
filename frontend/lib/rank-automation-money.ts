const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function positiveMoneyMicro(value: string): string | undefined {
  const normalized = value.trim().replace(",", ".");
  const match = /^(0|[1-9]\d{0,12})(?:\.(\d{1,6}))?$/u.exec(normalized);
  if (!match?.[1]) return undefined;
  const result = `${match[1]}${(match[2] ?? "").padEnd(6, "0")}`
    .replace(/^0+(?=\d)/u, "");
  if (result === "0" || BigInt(result) > POSTGRES_BIGINT_MAX) {
    return undefined;
  }
  return result;
}

export function microToRubles(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
