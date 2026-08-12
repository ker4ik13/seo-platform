/**
 * Deterministic Russian Snowball-style stem used by semantic cleaning tools.
 * Non-Russian tokens and very short words stay untouched.
 */
export function preciseRussianWordStem(value: string): string {
  const normalized = value.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
  if (!/^[а-я]+$/u.test(normalized) || normalized.length <= 3) {
    return normalized;
  }
  const firstVowel = normalized.search(/[аеиоуыэюя]/u);
  if (firstVowel < 0 || firstVowel === normalized.length - 1) {
    return normalized;
  }
  const prefix = normalized.slice(0, firstVowel + 1);
  let rv = normalized.slice(firstVowel + 1);

  const perfective = removeRussianSuffix(
    rv,
    /(?:ив|ивши|ившись|ыв|ывши|ывшись)$/u,
    /([ая])(?:в|вши|вшись)$/u
  );
  if (perfective === rv) {
    rv = rv.replace(/(?:ся|сь)$/u, "");
    const adjective = removeRussianSuffix(
      rv,
      /(?:ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/u
    );
    if (adjective !== rv) {
      rv = removeRussianSuffix(
        adjective,
        /(?:ивш|ывш|ующ)$/u,
        /([ая])(?:ем|нн|вш|ющ|щ)$/u
      );
    } else {
      const verb = removeRussianSuffix(
        rv,
        /(?:ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)$/u,
        /([ая])(?:ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ны|ть|ешь|нно)$/u
      );
      rv = verb === rv
        ? rv.replace(
            /(?:а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/u,
            ""
          )
        : verb;
    }
  } else {
    rv = perfective;
  }

  rv = rv.replace(/и$/u, "");
  let stem = prefix + rv;
  const r2Start = russianRegionStart(
    stem,
    russianRegionStart(stem, 0)
  );
  const derivational = /(ость|ост)$/u.exec(stem);
  if (derivational?.index !== undefined && derivational.index >= r2Start) {
    stem = stem.slice(0, derivational.index);
  }
  stem = stem
    .replace(/ейше$/u, "")
    .replace(/нн$/u, "н")
    .replace(/ь$/u, "");
  return stem.length >= 3 ? stem : normalized;
}

function removeRussianSuffix(
  value: string,
  unconditional: RegExp,
  conditional?: RegExp
): string {
  const removed = value.replace(unconditional, "");
  return removed !== value || !conditional
    ? removed
    : value.replace(conditional, "$1");
}

function russianRegionStart(value: string, from: number): number {
  for (
    let index = Math.max(0, from);
    index < value.length - 1;
    index += 1
  ) {
    if (
      /[аеиоуыэюя]/u.test(value[index]!) &&
      !/[аеиоуыэюя]/u.test(value[index + 1]!)
    ) {
      return index + 2;
    }
  }
  return value.length;
}
