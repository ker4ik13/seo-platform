export interface PlatformProviderAccountSnapshot {
  readonly id: string;
  readonly provider: "XMLSTOCK" | "ARSENKIN";
  readonly slot: number;
  readonly enabled: boolean;
  readonly checking: boolean;
  readonly remaining: string | null;
  readonly unit: "RUB" | "ARSENKIN_LIMITS";
  readonly checkedAt: string | null;
  readonly errorCode: string | null;
}
export interface AdminProviderAccount extends PlatformProviderAccountSnapshot {
  readonly estimatedBalanceMinor: number | null;
  readonly lowBalance: boolean;
  readonly stale: boolean;
}
