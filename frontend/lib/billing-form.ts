export type BillingBuyerFormType =
  | "INDIVIDUAL"
  | "INDIVIDUAL_ENTREPRENEUR"
  | "LEGAL_ENTITY";

export type BillingBuyerBusinessFields =
  | Readonly<Record<string, never>>
  | {
      readonly buyerName: string;
      readonly buyerInn: string;
    };

export function billingBuyerBusinessFields(
  buyerType: BillingBuyerFormType,
  rawName: string,
  rawInn: string
):
  | { readonly value: BillingBuyerBusinessFields }
  | { readonly error: string } {
  if (buyerType === "INDIVIDUAL") {
    // Values from a previously selected business type are hidden UI state
    // and must never leak into an individual checkout request.
    return { value: {} };
  }
  const buyerName = rawName.trim().normalize("NFC");
  const buyerInn = rawInn.trim();
  if (buyerName.length < 2 || buyerName.length > 200) {
    return { error: "Укажите наименование плательщика." };
  }
  const expectedDigits =
    buyerType === "INDIVIDUAL_ENTREPRENEUR" ? 12 : 10;
  if (!new RegExp(`^[0-9]{${expectedDigits}}$`, "u").test(buyerInn)) {
    return { error: `ИНН должен содержать ${expectedDigits} цифр.` };
  }
  return { value: { buyerName, buyerInn } };
}

export function billingDeliveryEmail(
  rawValue: string
): { readonly value: string } | { readonly error: string } {
  const value = rawValue.trim().normalize("NFKC").toLowerCase();
  if (
    value.length < 3 ||
    value.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  ) {
    return { error: "Укажите корректный email для чека." };
  }
  return { value };
}

export function billingRublesToMinor(
  value: string,
  minimumMinor = 1
): number | undefined {
  if (
    !Number.isSafeInteger(minimumMinor) ||
    minimumMinor < 1 ||
    minimumMinor > 100_000_000
  ) {
    throw new TypeError("Invalid billing minimum");
  }
  const match = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/u.exec(value);
  if (!match?.[1]) return undefined;
  const minor =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor < BigInt(minimumMinor) || minor > 100_000_000n) {
    return undefined;
  }
  return Number(minor);
}
