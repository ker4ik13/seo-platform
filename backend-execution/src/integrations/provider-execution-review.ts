export class ProviderExecutionReviewRequiredError extends Error {
  public constructor(){super("PROVIDER_REQUIRES_REVIEW");this.name="ProviderExecutionReviewRequiredError";}
}
export class ProviderCapacityUnavailableError extends Error {
  public constructor(){super("PROVIDER_CONCURRENCY_LIMITED");this.name="ProviderCapacityUnavailableError";}
}
