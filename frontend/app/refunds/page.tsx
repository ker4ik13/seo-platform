import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export default async function Page() {
  const locale = (await cookies()).get("seo_ui_locale")?.value === "en" ? "en" : "ru";
  redirect(`/${locale}/refunds`);
}
