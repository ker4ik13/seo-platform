export interface PrepareSystemConnectorsResult {
  readonly configured: boolean;
  readonly pending: boolean;
  readonly readyProviders: readonly ("XMLSTOCK" | "ARSENKIN")[];
}
