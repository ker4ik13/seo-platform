import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Позиции",
  robots: {
    index: false,
    follow: false
  }
};

export default async function TrackingContextsPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  if (!project) throw new Error("Project context is missing");
  redirect("/app/semantics");
}
