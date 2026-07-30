import { createHash, timingSafeEqual } from "node:crypto";

interface ServiceTokenRequest {
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly raw?: { readonly rawHeaders?: readonly string[] };
}

export function internalTokensEqual(
  expected: string,
  provided: string
): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}

export function singleServiceTokenHeader(
  request: ServiceTokenRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 512 ||
    value !== value.trim() ||
    hasInvalidTokenCharacter(value)
  ) {
    return undefined;
  }
  const rawHeaders = request.raw?.rawHeaders;
  if (rawHeaders === undefined) return value;
  if (rawHeaders.length % 2 !== 0) return undefined;
  let matches = 0;
  let rawValue: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      matches += 1;
      rawValue = rawHeaders[index + 1];
    }
  }
  return matches === 1 && rawValue === value ? value : undefined;
}

function hasInvalidTokenCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint < 0x21 ||
      codePoint === 0x7f ||
      character === "," ||
      /\s/u.test(character)
    ) {
      return true;
    }
  }
  return false;
}
