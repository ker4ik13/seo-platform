import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import type {
  IntegrationCredentialValidationSummary,
  IntegrationProvider,
  InternalCreateIntegrationCredentialValidationInput
} from "@seo-platform/contracts";
import type {
  IntegrationCredential,
  Job
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { INTEGRATION_CREDENTIAL_VALIDATION_MAX_ATTEMPTS } from "../queue/integration-credential-validation.queue.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import {
  ACTIVE_INTEGRATION_CREDENTIAL_VALIDATION_JOB_STATUSES,
  INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationRequestHash,
  integrationCredentialValidationScope,
  toValidationSummary,
  validationJobJson,
  validationRequestHashMatches
} from "./integration-credential-validation-job.js";

@Injectable()
export class IntegrationCredentialValidationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly connectors: IntegrationCredentialConnectorRegistry
  ) {}

  public async request(
    credentialId: string,
    input: InternalCreateIntegrationCredentialValidationInput,
    requestId: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const idempotencyScope =
      integrationCredentialValidationScope(credentialId);
    const requestHash = integrationCredentialValidationRequestHash({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      credentialId
    });

    const idempotent = await this.findIdempotent(
      input.workspaceId,
      idempotencyScope,
      input.idempotencyKey
    );
    if (idempotent) {
      this.assertIdempotentRequest(idempotent, requestHash);
      await this.enqueueIfPending(idempotent);
      return toValidationSummary(idempotent);
    }

    const credential = await this.loadCredential(
      credentialId,
      input.workspaceId
    );
    this.assertValidationAllowed(credential);
    const provider = providerValue(credential.provider);
    const deduplicationKey =
      integrationCredentialValidationDeduplicationKey(
        credential.id,
        credential.materialVersion
      );
    const active = await this.findActiveForMaterial(
      credential.workspaceId,
      deduplicationKey
    );
    if (active) {
      throw validationAlreadyRunning();
    }

    const connectorVersion = this.connectors.version(provider);
    let validation: Job;
    try {
      validation = await this.prisma.job.create({
        data: {
          workspaceId: credential.workspaceId,
          type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
          status: "QUEUED",
          stage: "credential_validation_queued",
          priority: 10,
          actorId: input.actorId,
          deduplicationKey,
          idempotencyScope,
          idempotencyKey: input.idempotencyKey,
          requestHash: databaseBytes(requestHash),
          inputSnapshot: validationJobJson({
            kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
            credentialId: credential.id,
            credentialMaterialVersion: credential.materialVersion,
            connectorVersion
          }),
          scopeSnapshot: validationJobJson({
            workspaceId: credential.workspaceId,
            credentialId: credential.id
          }),
          progressTotal: 1n,
          progressUnit: "credential",
          estimatedCostMicro: 0n,
          credentialMode: credential.mode,
          provider,
          maxAttempts:
            INTEGRATION_CREDENTIAL_VALIDATION_MAX_ATTEMPTS,
          correlationId: requestId,
          queuedAt: new Date()
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.concurrentWinner(
        credential.workspaceId,
        idempotencyScope,
        input.idempotencyKey,
        deduplicationKey,
        requestHash
      );
      if (!winner) throw error;
      validation = winner;
    }

    await this.enqueueIfPending(validation);
    return toValidationSummary(validation);
  }

  public async get(
    credentialId: string,
    validationId: string,
    workspaceId: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const validation = await this.prisma.job.findFirst({
      where: {
        id: validationId,
        workspaceId,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE
      }
    });
    if (!validation) throw validationNotFound();
    const summary = toValidationSummary(validation);
    if (summary.credentialId !== credentialId) {
      throw validationNotFound();
    }
    return summary;
  }

  private async concurrentWinner(
    workspaceId: string,
    idempotencyScope: string,
    idempotencyKey: string,
    deduplicationKey: string,
    requestHash: Buffer
  ): Promise<Job | undefined> {
    const idempotent = await this.findIdempotent(
      workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (idempotent) {
      this.assertIdempotentRequest(idempotent, requestHash);
      return idempotent;
    }
    if (
      await this.findActiveForMaterial(
        workspaceId,
        deduplicationKey
      )
    ) {
      throw validationAlreadyRunning();
    }
    return undefined;
  }

  private findIdempotent(
    workspaceId: string,
    idempotencyScope: string,
    idempotencyKey: string
  ): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId,
          idempotencyScope,
          idempotencyKey
        }
      }
    });
  }

  private findActiveForMaterial(
    workspaceId: string,
    deduplicationKey: string
  ): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: {
        workspaceId,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        deduplicationKey,
        status: {
          in: [
            ...ACTIVE_INTEGRATION_CREDENTIAL_VALIDATION_JOB_STATUSES
          ]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  }

  private async loadCredential(
    credentialId: string,
    workspaceId: string
  ): Promise<IntegrationCredential> {
    const credential =
      await this.prisma.integrationCredential.findFirst({
        where: { id: credentialId, workspaceId, deletedAt: null }
      });
    if (!credential) throw validationNotFound();
    return credential;
  }

  private assertValidationAllowed(
    credential: IntegrationCredential
  ): void {
    if (credential.mode !== "BYOK_API_KEY") {
      throw new UnprocessableEntityException(
        "Credential mode does not support API key validation"
      );
    }
    if (credential.status === "DISABLED") {
      throw new ConflictException("Credential is disabled");
    }
  }

  private assertIdempotentRequest(
    validation: Job,
    requestHash: Buffer
  ): void {
    if (
      validation.type !==
        INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE ||
      !validationRequestHashMatches(
        validation.requestHash,
        requestHash
      )
    ) {
      throw idempotencyConflict();
    }
  }

  private async enqueueIfPending(validation: Job): Promise<void> {
    if (
      validation.status !== "QUEUED" &&
      validation.status !== "RETRY_SCHEDULED" &&
      validation.status !== "WAITING_RATE_LIMIT"
    ) {
      return;
    }
    if (validation.retryAt && validation.retryAt > new Date()) return;
    try {
      await this.queue.enqueueIntegrationCredentialValidation(
        validation.id
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to schedule integration credential validation",
        { cause: error }
      );
    }
  }
}

function providerValue(value: string): IntegrationProvider {
  if (!["XMLSTOCK", "ARSENKIN", "KEYS_SO"].includes(value)) {
    throw new UnprocessableEntityException(
      "Credential provider is unsupported"
    );
  }
  return value as IntegrationProvider;
}

function validationNotFound(): NotFoundException {
  return new NotFoundException("Credential validation not found");
}

function idempotencyConflict(): ConflictException {
  return new ConflictException(
    "Idempotency key was already used for another credential validation request"
  );
}

function validationAlreadyRunning(): ConflictException {
  return new ConflictException(
    "A credential validation is already running for this credential version"
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}
