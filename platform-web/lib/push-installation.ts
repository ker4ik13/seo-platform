const DATABASE_NAME = "seo-platform-device";
const STORE_NAME = "metadata";
const INSTALLATION_KEY = "web-push-installation-v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PushInstallationRecord {
  readonly schemaVersion: 2;
  readonly installationId: string;
  readonly ownerUserId: string;
  readonly reconcileGeneration: number;
  readonly reconciledGeneration: number;
  readonly updatedAt: string;
}

export interface PushInstallationBinding {
  readonly record: PushInstallationRecord;
  readonly ownerConflict: boolean;
  readonly created: boolean;
}

export class PushInstallationStorageError extends Error {
  public readonly code:
      | "UNAVAILABLE"
      | "BLOCKED"
      | "INVALID_RECORD"
      | "FUTURE_VERSION"
      | "STALE_RECORD";

  public constructor(
    code:
      | "UNAVAILABLE"
      | "BLOCKED"
      | "INVALID_RECORD"
      | "FUTURE_VERSION"
      | "STALE_RECORD",
    message: string
  ) {
    super(message);
    this.name = "PushInstallationStorageError";
    this.code = code;
  }
}

export function reconcilePushInstallationRecord(
  current: PushInstallationRecord | undefined,
  ownerUserId: string,
  createInstallationId: () => string,
  now: () => string
): PushInstallationBinding {
  assertUuid(ownerUserId, "ownerUserId");
  if (current) {
    assertPushInstallationRecord(current);
    return {
      record: current,
      ownerConflict: current.ownerUserId !== ownerUserId,
      created: false
    };
  }
  const record: PushInstallationRecord = {
    schemaVersion: 2,
    installationId: canonicalInstallationId(createInstallationId()),
    ownerUserId,
    reconcileGeneration: 1,
    reconciledGeneration: 0,
    updatedAt: canonicalTimestamp(now())
  };
  return { record, ownerConflict: false, created: true };
}

export function pushReconciliationRequired(
  record: PushInstallationRecord
): boolean {
  assertPushInstallationRecord(record);
  return record.reconciledGeneration < record.reconcileGeneration;
}

export function withRequestedPushReconciliation(
  current: PushInstallationRecord,
  expectedOwnerUserId: string,
  expectedInstallationId: string,
  now: () => string
): PushInstallationRecord {
  assertPushInstallationRecord(current);
  if (
    current.ownerUserId !== expectedOwnerUserId ||
    current.installationId !== expectedInstallationId
  ) {
    throw new PushInstallationStorageError(
      "STALE_RECORD",
      "Локальная регистрация изменилась в другой вкладке"
    );
  }
  if (current.reconcileGeneration >= Number.MAX_SAFE_INTEGER) {
    invalidRecord();
  }
  return {
    ...current,
    reconcileGeneration: current.reconcileGeneration + 1,
    updatedAt: canonicalTimestamp(now())
  };
}

export function withCompletedPushReconciliation(
  current: PushInstallationRecord,
  expectedOwnerUserId: string,
  expectedInstallationId: string,
  expectedGeneration: number,
  now: () => string
): {
  readonly record: PushInstallationRecord;
  readonly cleared: boolean;
} {
  assertPushInstallationRecord(current);
  if (
    current.ownerUserId !== expectedOwnerUserId ||
    current.installationId !== expectedInstallationId
  ) {
    throw new PushInstallationStorageError(
      "STALE_RECORD",
      "Локальная регистрация изменилась в другой вкладке"
    );
  }
  if (
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 1
  ) {
    invalidRecord();
  }
  if (current.reconcileGeneration !== expectedGeneration) {
    return { record: current, cleared: false };
  }
  if (current.reconciledGeneration === expectedGeneration) {
    return { record: current, cleared: true };
  }
  return {
    record: {
      ...current,
      reconciledGeneration: expectedGeneration,
      updatedAt: canonicalTimestamp(now())
    },
    cleared: true
  };
}

export async function loadOrCreatePushInstallation(
  ownerUserId: string
): Promise<PushInstallationBinding> {
  return mutateRecord((current) =>
    reconcilePushInstallationRecord(
      current,
      ownerUserId,
      createInstallationId,
      () => new Date().toISOString()
    )
  );
}

export async function requestPushReconciliation(
  ownerUserId: string,
  installationId: string
): Promise<{
  readonly record: PushInstallationRecord;
  readonly generation: number;
}> {
  const result = await mutateRecord((current) => {
    if (!current) {
      throw new PushInstallationStorageError(
        "STALE_RECORD",
        "Локальная регистрация устройства не найдена"
      );
    }
    const record = withRequestedPushReconciliation(
      current,
      ownerUserId,
      installationId,
      () => new Date().toISOString()
    );
    return { record, ownerConflict: false, created: false };
  });
  return {
    record: result.record,
    generation: result.record.reconcileGeneration
  };
}

export async function completePushReconciliation(
  ownerUserId: string,
  installationId: string,
  expectedGeneration: number
): Promise<{
  readonly record: PushInstallationRecord;
  readonly cleared: boolean;
}> {
  let cleared = false;
  const result = await mutateRecord((current) => {
    if (!current) {
      throw new PushInstallationStorageError(
        "STALE_RECORD",
        "Локальная регистрация устройства не найдена"
      );
    }
    const completion = withCompletedPushReconciliation(
      current,
      ownerUserId,
      installationId,
      expectedGeneration,
      () => new Date().toISOString()
    );
    cleared = completion.cleared;
    return {
      record: completion.record,
      ownerConflict: false,
      created: false
    };
  });
  return { record: result.record, cleared };
}

export async function resetPushInstallationRecord(
  ownerUserId: string
): Promise<PushInstallationRecord> {
  assertUuid(ownerUserId, "ownerUserId");
  const record: PushInstallationRecord = {
    schemaVersion: 2,
    installationId: createInstallationId(),
    ownerUserId,
    reconcileGeneration: 1,
    reconciledGeneration: 0,
    updatedAt: new Date().toISOString()
  };
  await writeRecord(record);
  return record;
}

async function mutateRecord(
  mutation: (
    current: PushInstallationRecord | undefined
  ) => PushInstallationBinding
): Promise<PushInstallationBinding> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, "readwrite");
    } catch (error) {
      database.close();
      reject(storageFailure(error));
      return;
    }
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(INSTALLATION_KEY);
    let result: PushInstallationBinding | undefined;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const current =
          request.result === undefined
            ? undefined
            : parsePushInstallationRecord(request.result);
        result = mutation(current);
        store.put(result.record, INSTALLATION_KEY);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    request.onerror = () => {
      failure = request.error;
    };
    transaction.oncomplete = () => {
      database.close();
      if (!result) {
        reject(storageFailure(failure));
        return;
      }
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(storageFailure(failure ?? transaction.error));
    };
    transaction.onabort = () => {
      database.close();
      reject(storageFailure(failure ?? transaction.error));
    };
  });
}

async function writeRecord(record: PushInstallationRecord): Promise<void> {
  assertPushInstallationRecord(record);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, INSTALLATION_KEY);
    } catch (error) {
      database.close();
      reject(storageFailure(error));
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(storageFailure(transaction.error));
    };
    transaction.onabort = () => {
      database.close();
      reject(storageFailure(transaction.error));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new PushInstallationStorageError(
        "UNAVAILABLE",
        "Браузерное хранилище недоступно"
      )
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    let settled = false;
    const rejectOnce = (error: PushInstallationStorageError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => rejectOnce(storageFailure(request.error));
    request.onblocked = () =>
      rejectOnce(
        new PushInstallationStorageError(
          "BLOCKED",
          "Закройте другие вкладки приложения и повторите попытку"
        )
      );
  });
}

export function parsePushInstallationRecord(
  value: unknown
): PushInstallationRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalidRecord();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.schemaVersion === "number" &&
    record.schemaVersion > 2
  ) {
    throw new PushInstallationStorageError(
      "FUTURE_VERSION",
      "Локальная регистрация создана более новой версией приложения"
    );
  }
  if (record.schemaVersion === 1) {
    return migrateVersionOneRecord(record);
  }
  const keys = Object.keys(record);
  if (
    keys.length !== 6 ||
    ![
      "schemaVersion",
      "installationId",
      "ownerUserId",
      "reconcileGeneration",
      "reconciledGeneration",
      "updatedAt"
    ].every((key) => keys.includes(key)) ||
    record.schemaVersion !== 2 ||
    typeof record.installationId !== "string" ||
    typeof record.ownerUserId !== "string" ||
    typeof record.reconcileGeneration !== "number" ||
    typeof record.reconciledGeneration !== "number" ||
    typeof record.updatedAt !== "string"
  ) {
    invalidRecord();
  }
  const parsed: PushInstallationRecord = {
    schemaVersion: 2,
    installationId: record.installationId,
    ownerUserId: record.ownerUserId,
    reconcileGeneration: record.reconcileGeneration,
    reconciledGeneration: record.reconciledGeneration,
    updatedAt: record.updatedAt
  };
  assertPushInstallationRecord(parsed);
  return parsed;
}

function assertPushInstallationRecord(
  record: PushInstallationRecord
): void {
  if (
    record.schemaVersion !== 2 ||
    !UUID_PATTERN.test(record.installationId) ||
    !UUID_PATTERN.test(record.ownerUserId) ||
    !Number.isSafeInteger(record.reconcileGeneration) ||
    record.reconcileGeneration < 0 ||
    !Number.isSafeInteger(record.reconciledGeneration) ||
    record.reconciledGeneration < 0 ||
    record.reconciledGeneration > record.reconcileGeneration ||
    !isIsoTimestamp(record.updatedAt)
  ) {
    invalidRecord();
  }
}

function migrateVersionOneRecord(
  record: Readonly<Record<string, unknown>>
): PushInstallationRecord {
  const keys = Object.keys(record);
  if (
    keys.length !== 5 ||
    ![
      "schemaVersion",
      "installationId",
      "ownerUserId",
      "reconcileRequired",
      "updatedAt"
    ].every((key) => keys.includes(key)) ||
    typeof record.installationId !== "string" ||
    typeof record.ownerUserId !== "string" ||
    typeof record.reconcileRequired !== "boolean" ||
    typeof record.updatedAt !== "string"
  ) {
    invalidRecord();
  }
  const migrated: PushInstallationRecord = {
    schemaVersion: 2,
    installationId: record.installationId,
    ownerUserId: record.ownerUserId,
    reconcileGeneration: record.reconcileRequired ? 1 : 0,
    reconciledGeneration: 0,
    updatedAt: record.updatedAt
  };
  assertPushInstallationRecord(migrated);
  return migrated;
}

function createInstallationId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return canonicalInstallationId(crypto.randomUUID());
  }
  if (
    typeof crypto === "undefined" ||
    typeof crypto.getRandomValues !== "function"
  ) {
    throw new PushInstallationStorageError(
      "UNAVAILABLE",
      "Браузер не поддерживает безопасный идентификатор устройства"
    );
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalInstallationId(value: string): string {
  const normalized = value.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new PushInstallationStorageError(
      "INVALID_RECORD",
      "Не удалось создать идентификатор устройства"
    );
  }
  return normalized;
}

function canonicalTimestamp(value: string): string {
  if (!isIsoTimestamp(value)) {
    throw new PushInstallationStorageError(
      "INVALID_RECORD",
      "Некорректное время локальной регистрации"
    );
  }
  return value;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new PushInstallationStorageError(
      "INVALID_RECORD",
      `Некорректный ${field}`
    );
  }
}

function isIsoTimestamp(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function invalidRecord(): never {
  throw new PushInstallationStorageError(
    "INVALID_RECORD",
    "Локальная регистрация Web Push повреждена"
  );
}

function storageFailure(value: unknown): PushInstallationStorageError {
  if (value instanceof PushInstallationStorageError) return value;
  return new PushInstallationStorageError(
    "UNAVAILABLE",
    "Не удалось открыть браузерное хранилище"
  );
}
