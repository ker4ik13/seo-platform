import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OperationResultWorkspace } from "../../../../../../components/operation-result-workspace";
import {
  isOperationResultId,
  operationResultKind
} from "../../../../../../lib/operation-result-routes";
import { requireProtectedAppContext } from "../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Результат операции",
  robots: { index: false, follow: false }
};

export default async function OperationResultPage({
  params
}: Readonly<{
  params: Promise<{
    readonly kind: string;
    readonly operationId: string;
  }>;
}>) {
  const { kind: rawKind, operationId } = await params;
  const kind = operationResultKind(rawKind);
  if (!kind || !isOperationResultId(operationId)) notFound();

  const context = await requireProtectedAppContext();
  if (!context.project) redirect("/app/tasks");

  return (
    <OperationResultWorkspace
      kind={kind}
      operationId={operationId}
      projectId={context.project.id}
    />
  );
}
