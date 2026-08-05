import type {
  AcceptProjectTransferInput,
  CreateProjectTransferInput
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";
import { inputObject, stringField } from "../common/input.js";

export function createProjectTransferInput(
  value: unknown
): CreateProjectTransferInput {
  const input = inputObject(value);
  const targetMemberId = stringField(input, "targetMemberId", {
    min: 36,
    max: 36
  });
  assertUuid(targetMemberId, "targetMemberId");
  return { targetMemberId };
}

export function acceptProjectTransferInput(
  value: unknown
): AcceptProjectTransferInput {
  const input = inputObject(value);
  const destinationWorkspaceId = stringField(
    input,
    "destinationWorkspaceId",
    { min: 36, max: 36 }
  );
  assertUuid(destinationWorkspaceId, "destinationWorkspaceId");
  return { destinationWorkspaceId };
}
