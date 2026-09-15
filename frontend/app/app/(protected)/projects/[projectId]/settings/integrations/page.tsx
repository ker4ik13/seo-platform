import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ProjectIntegrationSettingsPage(): never {
  redirect("/app/settings/integrations");
}
