import {
  Inject,
  Injectable,
  Optional,
  type OnModuleInit
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  IntegrationCredentialExecutionBrokerService,
  type IntegrationCredentialExecutionKekCanaryRecord
} from "./integration-credential-execution-broker.service.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";

const EXECUTION_CANARY_WAIT_POLICY = Symbol("EXECUTION_CANARY_WAIT_POLICY");
const DEFAULT_EXECUTION_CANARY_WAIT_POLICY: CanaryWaitPolicy = {
  attempts: 120,
  intervalMs: 250
};

export interface CanaryWaitPolicy {
  readonly attempts: number;
  readonly intervalMs: number;
}

@Injectable()
export class IntegrationCredentialKeyCoverageService
  implements OnModuleInit
{
  public constructor(
    private readonly broker: IntegrationCredentialExecutionBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    @Inject(EXECUTION_CANARY_WAIT_POLICY)
    private readonly canaryWaitPolicy: CanaryWaitPolicy =
      DEFAULT_EXECUTION_CANARY_WAIT_POLICY
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.config.integrationCredentials.enabled) return;

    if (this.config.integrationCredentials.role === "EXECUTION") {
      await this.verifyExecutionCanaries();
      return;
    }

    const versions = await this.broker.keyVersions();
    const missingEncryptionKeys = missingKeyVersions(
      versions.encryption,
      this.config.integrationCredentials.keys
    );
    const missingFingerprintKeys = missingKeyVersions(
      versions.fingerprint,
      this.config.integrationCredentials.fingerprintKeys
    );
    if (
      missingEncryptionKeys.length > 0 ||
      missingFingerprintKeys.length > 0
    ) {
      throw new Error(
        [
          missingEncryptionKeys.length > 0
            ? `encryption versions: ${missingEncryptionKeys.join(", ")}`
            : undefined,
          missingFingerprintKeys.length > 0
            ? `fingerprint versions: ${missingFingerprintKeys.join(", ")}`
            : undefined
        ]
          .filter(Boolean)
          .join("; ")
          .replace(
            /^/u,
            "Integration credential keyrings do not cover database "
          )
      );
    }

    await this.registerAndVerifyManagementCanaries();
  }

  private async registerAndVerifyManagementCanaries(): Promise<void> {
    const failedVersions: number[] = [];
    for (const keyVersion of uniqueSortedVersions([
      ...this.config.integrationCredentials.keys.keys()
    ])) {
      try {
        const candidate = this.crypto.createKekCanary(keyVersion);
        const registered = await this.broker.registerKekCanary(candidate);
        if (!registered.encrypted) throw new Error("Missing KEK canary");
        this.crypto.verifyKekCanary(registered.encrypted);
      } catch {
        failedVersions.push(keyVersion);
      }
    }
    this.throwCanaryFailures(failedVersions);
  }

  private async verifyExecutionCanaries(): Promise<void> {
    const configuredVersions = uniqueSortedVersions([
      ...this.config.integrationCredentials.keys.keys()
    ]);
    let canaries = await this.broker.executionKekCanaries(configuredVersions);
    this.throwMissingExecutionKeys(canaries);
    for (
      let attempt = 0;
      hasMissingCanary(canaries) &&
        attempt < this.canaryWaitPolicy.attempts;
      attempt += 1
    ) {
      await delay(this.canaryWaitPolicy.intervalMs);
      canaries = await this.broker.executionKekCanaries(configuredVersions);
      this.throwMissingExecutionKeys(canaries);
    }

    const failedVersions: number[] = [];
    for (const canary of canaries) {
      try {
        if (!canary.encrypted) throw new Error("Missing KEK canary");
        this.crypto.verifyKekCanary(canary.encrypted);
      } catch {
        failedVersions.push(canary.keyVersion);
      }
    }
    this.throwCanaryFailures(failedVersions);
  }

  private throwMissingExecutionKeys(
    canaries: readonly IntegrationCredentialExecutionKekCanaryRecord[]
  ): void {
    const usedVersions = canaries
      .filter(({ usedByCredential }) => usedByCredential)
      .map(({ keyVersion }) => keyVersion);
    const missingEncryptionKeys = missingKeyVersions(
      usedVersions,
      this.config.integrationCredentials.keys
    );
    if (missingEncryptionKeys.length > 0) {
      throw new Error(
        `Integration credential keyrings do not cover database encryption versions: ${missingEncryptionKeys.join(", ")}`
      );
    }
  }

  private throwCanaryFailures(failedVersions: readonly number[]): void {
    if (failedVersions.length > 0) {
      throw new Error(
        `Integration credential decrypt canary failed for encryption versions: ${failedVersions.join(", ")}`
      );
    }
  }
}

export function missingKeyVersions(
  usedVersions: readonly number[],
  configuredKeys: ReadonlyMap<number, Buffer>
): readonly number[] {
  return uniqueSortedVersions(usedVersions)
    .filter((version) => !configuredKeys.has(version));
}

function uniqueSortedVersions(
  versions: readonly number[]
): readonly number[] {
  return [...new Set(versions)].sort((left, right) => left - right);
}

function hasMissingCanary(
  canaries: readonly { readonly encrypted?: unknown }[]
): boolean {
  return canaries.some(({ encrypted }) => !encrypted);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
