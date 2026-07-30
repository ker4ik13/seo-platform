import {
  InvalidRealtimeTicketContractError,
  issueRealtimeProjectTicketInput,
  type IssueRealtimeProjectTicketInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

export function realtimeTicketInput(
  value: unknown
): IssueRealtimeProjectTicketInput {
  try {
    return issueRealtimeProjectTicketInput(value);
  } catch (error) {
    if (error instanceof InvalidRealtimeTicketContractError) {
      throw validationError(
        "clientInstanceId",
        "INVALID_IDENTIFIER",
        "A single canonical client instance UUID is required"
      );
    }
    throw error;
  }
}
