import { DomainError } from "../common/domain-error.js";

export function unauthenticatedError(): DomainError {
  return new DomainError({
    statusCode: 401,
    code: "UNAUTHENTICATED",
    message: "Authentication required"
  });
}
