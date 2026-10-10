import type { ReactNode } from "react";

export function ConfirmationActions({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <div className="confirmation-actions">{children}</div>;
}
