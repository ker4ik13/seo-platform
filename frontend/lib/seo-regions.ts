export interface SeoRegion {
  readonly name: string;
  readonly wordstatCode: string;
  readonly yandexCode: string;
  readonly googleCode: string;
}

// Yandex IDs are shared by Wordstat and Yandex SERP. Google IDs follow the
// current Arsenkin Google region catalog referenced by its public API docs.
export const seoRegions: readonly SeoRegion[] = [
  { name: "Россия", wordstatCode: "225", yandexCode: "225", googleCode: "2643" },
  { name: "Москва", wordstatCode: "213", yandexCode: "213", googleCode: "1011969" },
  { name: "Санкт-Петербург", wordstatCode: "2", yandexCode: "2", googleCode: "1012040" },
  { name: "Новосибирск", wordstatCode: "65", yandexCode: "65", googleCode: "1011984" },
  { name: "Екатеринбург", wordstatCode: "54", yandexCode: "54", googleCode: "1012052" },
  { name: "Казань", wordstatCode: "43", yandexCode: "43", googleCode: "1012054" },
  { name: "Нижний Новгород", wordstatCode: "47", yandexCode: "47", googleCode: "1011981" },
  { name: "Самара", wordstatCode: "51", yandexCode: "51", googleCode: "1012029" },
  { name: "Омск", wordstatCode: "66", yandexCode: "66", googleCode: "1011985" },
  { name: "Красноярск", wordstatCode: "62", yandexCode: "62", googleCode: "1011941" },
  { name: "Челябинск", wordstatCode: "56", yandexCode: "56", googleCode: "1011874" },
  { name: "Уфа", wordstatCode: "172", yandexCode: "172", googleCode: "1011867" },
  { name: "Ростов-на-Дону", wordstatCode: "39", yandexCode: "39", googleCode: "1012013" },
  { name: "Краснодар", wordstatCode: "35", yandexCode: "35", googleCode: "1011905" },
  { name: "Пермь", wordstatCode: "50", yandexCode: "50", googleCode: "1011993" },
  { name: "Воронеж", wordstatCode: "193", yandexCode: "193", googleCode: "1012077" },
  { name: "Волгоград", wordstatCode: "38", yandexCode: "38", googleCode: "1012068" },
  { name: "Владивосток", wordstatCode: "75", yandexCode: "75", googleCode: "1012008" },
  { name: "Хабаровск", wordstatCode: "76", yandexCode: "76", googleCode: "1011918" }
] as const;

export type SeoRegionCodeKind = "WORDSTAT" | "YANDEX_RANK" | "GOOGLE_RANK";

export function seoRegionCode(region: SeoRegion, kind: SeoRegionCodeKind): string {
  if (kind === "WORDSTAT") return region.wordstatCode;
  if (kind === "YANDEX_RANK") return region.yandexCode;
  return region.googleCode;
}
