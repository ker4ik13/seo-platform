import { redirect } from "next/navigation";
import { isLocale } from "../lib/locales";

export default function Home() {
  const configuredLocale = process.env.DEFAULT_LOCALE ?? "ru";
  redirect(`/${isLocale(configuredLocale) ? configuredLocale : "ru"}`);
}
