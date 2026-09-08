/** Private, ephemeral JIT material. Never put this projection in a queue or log. */
export interface InternalNpdIssueMaterial {
  readonly receiptId: string;
  readonly leaseToken: string;
  readonly amountMinor: string;
  readonly paidAt: string;
  readonly description: string;
  readonly buyerType: "INDIVIDUAL" | "INDIVIDUAL_ENTREPRENEUR" | "LEGAL_ENTITY";
  readonly buyerName?: string;
  readonly buyerInn?: string;
}
export interface InternalNpdIssueResult {
  readonly receiptId: string;
  readonly leaseToken: string;
  readonly officialReceiptId: string;
  readonly officialReceiptUrl: string;
}
