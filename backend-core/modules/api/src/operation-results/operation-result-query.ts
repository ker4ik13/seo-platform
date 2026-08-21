import {
  operationResultDefaultPageSize,
  operationResultPageSizes,
  type OperationResultPageSize
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export function operationResultPageQuery(
  limitValue: unknown,
  cursorValue: unknown,
  maximumSequence: number
): Readonly<{
  limit: OperationResultPageSize;
  cursor?: string;
}> {
  const limit = pageLimit(limitValue);
  const cursor = pageCursor(cursorValue, maximumSequence);
  return { limit, ...(cursor === undefined ? {} : { cursor }) };
}

function pageLimit(value: unknown): OperationResultPageSize {
  if (value === undefined) return operationResultDefaultPageSize;
  const parsed = Number(value);
  if (
    typeof value !== "string" ||
    !Number.isSafeInteger(parsed) ||
    !operationResultPageSizes.some((size) => size === parsed)
  ) {
    invalid("Invalid operation result page size");
  }
  return parsed as OperationResultPageSize;
}

function pageCursor(
  value: unknown,
  maximumSequence: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})$/u.test(value)) {
    invalid("Invalid operation result cursor");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximumSequence) {
    invalid("Invalid operation result cursor");
  }
  return value;
}

function invalid(message: string): never {
  throw new DomainError({
    statusCode: 400,
    code: "VALIDATION_FAILED",
    message
  });
}
