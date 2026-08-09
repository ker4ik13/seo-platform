import type { Metadata } from "next";
import { PublicProjectNoteView } from "../../../components/public-project-note";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Публичная заметка",
  robots: { index: false, follow: false, nocache: true }
};

export default async function PublicNotePage({
  params
}: Readonly<{ params: Promise<{ readonly token: string }> }>) {
  const { token } = await params;
  return <PublicProjectNoteView token={token} />;
}
