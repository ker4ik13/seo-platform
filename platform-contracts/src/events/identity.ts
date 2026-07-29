export interface SessionFamilyRevokedEventDataV1 {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: string;
}

export function sessionFamilyRevokedEventDataV1(input: {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: Date;
}): SessionFamilyRevokedEventDataV1 {
  return {
    userId: input.userId,
    sessionFamilyId: input.sessionFamilyId,
    revokedAt: input.revokedAt.toISOString()
  };
}
