import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Семантика",
  robots: {
    index: false,
    follow: false
  }
};

export default async function LegacyRankingsPage() {
  await requireProtectedAppContext();
  redirect("/app/semantics");
}
