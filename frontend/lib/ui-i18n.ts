import { uiEnglish } from "./ui-translations.ts";
export type UiLocale = "ru" | "en";
export const uiLocaleCookie = "seo_ui_locale";
export function normalizedUiLocale(value: string | undefined | null): UiLocale { return value?.toLowerCase().startsWith("en") ? "en" : "ru"; }
const entities: Readonly<Record<string, string>> = { quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: "\u00a0" };
const decodeCopy = (copy: string): string => copy.replace(/&(quot|apos|amp|lt|gt|nbsp);/gu, (match, name: string) => entities[name] ?? match);
// Legacy presentation helpers return formatted messages. Match only explicitly
// marked UI copy against authored templates, without regex backtracking or
// recursively translating interpolated names, URLs, keywords or other values.
const templates = Object.entries(uiEnglish).flatMap(([source, english]) => {
  const markers = [...source.matchAll(/\{(\d+)\}/gu)];
  if (!markers.length) return [];
  const parts = source.split(/\{\d+\}/gu);
  const literalLength = parts.reduce((sum, part) => sum + part.length, 0);
  if (literalLength < 6 || parts.slice(1, -1).some(part => part.length === 0)) return [];
  return [{ parts, indices: markers.map(marker => Number(marker[1])), english, literalLength }];
}).sort((a, b) => b.literalLength - a.literalLength);
function formattedMessage(text: string): { copy: string; values: string[] } | undefined {
  if (text.length > 8192 || !/[а-яё]/iu.test(text)) return undefined;
  for (const template of templates) {
    if (!text.startsWith(template.parts[0]!) || !text.endsWith(template.parts.at(-1)!)) continue;
    let position = template.parts[0]!.length, valid = true;
    const values: string[] = [];
    for (let index = 0; index < template.indices.length; index++) {
      const next = template.parts[index + 1]!;
      const last = index === template.indices.length - 1;
      const end = last ? text.length - next.length : text.indexOf(next, position);
      if (end < position) { valid = false; break; }
      const value = text.slice(position, end), slot = template.indices[index]!;
      if (values[slot] !== undefined && values[slot] !== value) { valid = false; break; }
      values[slot] = value;
      position = end + next.length;
    }
    if (valid && position === text.length) return { copy: template.english, values };
  }
  return undefined;
}
export function translateUi(locale: UiLocale, text: string, values: readonly string[] = []): string {
  const key = text.replace(/\s+/gu, " ").trim();
  const legacy = locale === "en" && !uiEnglish[key] && values.length === 0 ? formattedMessage(text) : undefined;
  const translated = locale === "en" ? uiEnglish[key] ?? legacy?.copy ?? text : text;
  // Decode only authored JSX copy, before inserting user values. React escapes
  // the final text; this never creates HTML or changes a keyword/name payload.
  const literal = decodeCopy(translated);
  return literal.replace(/\{([0-9]+)\}/gu, (match, index: string) => (legacy?.values ?? values)[Number(index)] ?? match);
}
export interface UiMessage { readonly text: string; readonly values?: readonly string[] }
