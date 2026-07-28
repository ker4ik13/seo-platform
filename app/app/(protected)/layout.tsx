import type { ReactNode } from "react";
import { requireProtectedAppContext } from "../../../lib/protected-app";

export default async function ProtectedAppLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  await requireProtectedAppContext();
  return children;
}
