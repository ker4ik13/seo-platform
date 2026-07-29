import type { WebPushSubscriptionInput } from "@seo-platform/contracts";
import type { PushInstallationRecord } from "./push-installation.ts";
import {
  type PushSubscriptionLike,
  webPushSubscriptionMatchesInput
} from "./push-notifications.ts";

export interface PushRegistrationReconciliationActions {
  readonly request: (
    ownerUserId: string,
    installationId: string
  ) => Promise<{
    readonly record: PushInstallationRecord;
    readonly generation: number;
  }>;
  readonly complete: (
    ownerUserId: string,
    installationId: string,
    expectedGeneration: number
  ) => Promise<{
    readonly record: PushInstallationRecord;
    readonly cleared: boolean;
  }>;
}

export type PushRegistrationReconciliationResult =
  | {
      readonly status: "COMPLETED";
      readonly record: PushInstallationRecord;
    }
  | {
      readonly status: "REARMED_AFTER_LOCAL_CHANGE";
      readonly record: PushInstallationRecord;
    }
  | {
      readonly status: "SUPERSEDED";
      readonly record: PushInstallationRecord;
    };

export async function settlePushRegistrationReconciliation(
  input: {
    readonly ownerUserId: string;
    readonly installationId: string;
    readonly sentGeneration: number;
    readonly sentSubscription: WebPushSubscriptionInput;
    readonly currentSubscription: PushSubscriptionLike | null;
  },
  actions: PushRegistrationReconciliationActions
): Promise<PushRegistrationReconciliationResult> {
  if (
    !input.currentSubscription ||
    !webPushSubscriptionMatchesInput(
      input.currentSubscription,
      input.sentSubscription
    )
  ) {
    const pending = await actions.request(
      input.ownerUserId,
      input.installationId
    );
    return {
      status: "REARMED_AFTER_LOCAL_CHANGE",
      record: pending.record
    };
  }

  const completion = await actions.complete(
    input.ownerUserId,
    input.installationId,
    input.sentGeneration
  );
  return {
    status: completion.cleared ? "COMPLETED" : "SUPERSEDED",
    record: completion.record
  };
}
