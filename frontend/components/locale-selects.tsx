"use client";

import { useMemo } from "react";
import { CustomSelect, type CustomSelectProps } from "./custom-select";


const LOCALES = [
  ["ru", "Русский · ru"],
  ["ru-RU", "Русский (Россия) · ru-RU"],
  ["en", "English · en"],
  ["en-US", "English (United States) · en-US"],
  ["en-GB", "English (United Kingdom) · en-GB"],
  ["de", "Deutsch · de"],
  ["de-DE", "Deutsch (Deutschland) · de-DE"],
  ["fr", "Français · fr"],
  ["fr-FR", "Français (France) · fr-FR"],
  ["es", "Español · es"],
  ["es-ES", "Español (España) · es-ES"],
  ["it", "Italiano · it"],
  ["pt", "Português · pt"],
  ["pt-BR", "Português (Brasil) · pt-BR"],
  ["pl", "Polski · pl"],
  ["uk", "Українська · uk"],
  ["be", "Беларуская · be"],
  ["kk", "Қазақша · kk"],
  ["uz", "O‘zbekcha · uz"],
  ["tr", "Türkçe · tr"],
  ["ar", "العربية · ar"],
  ["he", "עברית · he"],
  ["zh-CN", "简体中文 · zh-CN"],
  ["ja", "日本語 · ja"],
  ["ko", "한국어 · ko"]
] as const;

const TIMEZONES = [
  "UTC",
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "Europe/Minsk",
  "Europe/Istanbul",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  "Asia/Baku",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney"
] as const;

type SharedProps = Omit<CustomSelectProps, "children" | "value"> & {
  readonly value: string;
};

export function LanguageSelect(props: SharedProps) {
  return <LocaleChoice {...props} languageOnly />;
}

export function LocaleSelect(props: SharedProps) {
  return <LocaleChoice {...props} />;
}

function LocaleChoice({ languageOnly = false, value, ...props }: SharedProps & Readonly<{ languageOnly?: boolean }>) {
  const options = useMemo(() => {
    const available = languageOnly
      ? LOCALES.filter(([code]) => !code.includes("-") || code === value)
      : LOCALES;
    return available.some(([code]) => code === value)
      ? available
      : [[value, value] as const, ...available];
  }, [languageOnly, value]);
  return (
    <CustomSelect searchable searchPlaceholder="Найти язык" value={value} {...props}>
      {options.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    </CustomSelect>
  );
}

export function TimezoneSelect({ value, ...props }: SharedProps) {
  const options = useMemo(() => {
    const values = supportedTimezones();
    return values.includes(value) ? values : [value, ...values];
  }, [value]);
  return (
    <CustomSelect searchable searchPlaceholder="Найти город или часовой пояс" value={value} {...props}>
      {options.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
    </CustomSelect>
  );
}

function supportedTimezones(): readonly string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  try {
    const values = intl.supportedValuesOf?.("timeZone") ?? [];
    return [...new Set([...TIMEZONES, ...values])].sort((left, right) => {
      if (left === "UTC") return -1;
      if (right === "UTC") return 1;
      return left.localeCompare(right, "en");
    });
  } catch {
    return TIMEZONES;
  }
}
