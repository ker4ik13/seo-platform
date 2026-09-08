/** Presentation anchor only. Raw geographic keys are never presence identifiers. */
export function semanticColumnPresenceKey(value: string): string {
  if (/^[A-Za-z0-9:_-]{1,100}$/u.test(value)) return value;
  let first = 2_166_136_261, second = 5_381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second, 33) ^ code;
  }
  return `dimension:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
