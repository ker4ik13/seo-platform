import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Семантика",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RankHistoryPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  if (!context.project) throw new Error("Project context is missing");
  redirect("/app/semantics");
}
