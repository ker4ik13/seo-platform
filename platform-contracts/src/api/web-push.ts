export const webPushRegistrationStatuses = [
  "AVAILABLE",
  "DISABLED"
] as const;

export type WebPushRegistrationStatus =
  (typeof webPushRegistrationStatuses)[number];

export const webPushDisabledReasons = ["SERVER_NOT_CONFIGURED"] as const;

export type WebPushDisabledReason = (typeof webPushDisabledReasons)[number];

export const webPushDeviceStatuses = [
  "ACTIVE",
  "REVOKED",
  "EXPIRED"
] as const;

export type WebPushDeviceStatus = (typeof webPushDeviceStatuses)[number];

export const webPushDeviceStatusReasons = [
  "USER_REVOKED",
  "SESSION_REVOKED",
  "PERMISSION_REVOKED",
  "PUSH_SERVICE_GONE",
  "ACCOUNT_CHANGED"
] as const;

export type WebPushDeviceStatusReason =
  (typeof webPushDeviceStatusReasons)[number];

export const webPushDeliveryStatuses = [
  "NEVER",
  "DELIVERED",
  "FAILED"
] as const;

export type WebPushDeliveryStatus =
  (typeof webPushDeliveryStatuses)[number];

export const webPushRegistrationIntents = [
  "ENABLE",
  "RECONCILE"
] as const;

export type WebPushRegistrationIntent =
  (typeof webPushRegistrationIntents)[number];

export const webPushBrowsers = [
  "CHROME",
  "EDGE",
  "FIREFOX",
  "OPERA",
  "SAFARI",
  "OTHER"
] as const;

export type WebPushBrowser = (typeof webPushBrowsers)[number];

export const webPushPlatforms = [
  "ANDROID",
  "CHROMEOS",
  "IOS",
  "LINUX",
  "MACOS",
  "WINDOWS",
  "OTHER"
] as const;

export type WebPushPlatform = (typeof webPushPlatforms)[number];

export type WebPushRegistration =
  | {
      readonly status: "AVAILABLE";
      /**
       * Canonical unpadded base64url representation of the active VAPID
       * P-256 public key.
       */
      readonly applicationServerKey: string;
      /** Positive integer identifying the immutable VAPID key version. */
      readonly applicationServerKeyVersion: number;
      /** Positive server-side limit for simultaneously active devices. */
      readonly maxActiveDevices: number;
      /**
       * True only when the durable sender has complete VAPID configuration
       * and is enabled server-side.
       */
      readonly deliveryAvailable: boolean;
      readonly testDeliveryAvailable: false;
    }
  | {
      readonly status: "DISABLED";
      readonly reason: WebPushDisabledReason;
      /** Positive server-side policy limit, even while registration is off. */
      readonly maxActiveDevices: number;
      readonly deliveryAvailable: false;
      readonly testDeliveryAvailable: false;
    };

export interface WebPushDeviceSummary {
  readonly installationId: string;
  readonly label: string;
  readonly status: WebPushDeviceStatus;
  readonly statusReason?: WebPushDeviceStatusReason;
  readonly browser: WebPushBrowser;
  readonly platform: WebPushPlatform;
  /** Positive immutable VAPID public-key version used for registration. */
  readonly applicationServerKeyVersion: number;
  readonly expirationAt?: string;
  readonly lastDeliveryStatus: WebPushDeliveryStatus;
  readonly lastDeliveryAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string;
  readonly expiredAt?: string;
  readonly version: number;
}

export interface WebPushSubscriptionsState {
  readonly registration: WebPushRegistration;
  /** Bounded server-side projection; it never contains push credentials. */
  readonly devices: readonly WebPushDeviceSummary[];
}

export interface WebPushSubscriptionKeysInput {
  /** Canonical unpadded base64url P-256 public key. */
  readonly p256dh: string;
  /** Canonical unpadded base64url authentication secret. */
  readonly auth: string;
}

export interface WebPushSubscriptionInput {
  readonly endpoint: string;
  readonly expirationTime: number | null;
  readonly keys: WebPushSubscriptionKeysInput;
}

export interface UpsertWebPushSubscriptionInput {
  readonly label: string;
  readonly intent: WebPushRegistrationIntent;
  /** Positive version returned by the registration state endpoint. */
  readonly applicationServerKeyVersion: number;
  readonly subscription: WebPushSubscriptionInput;
}

/**
 * Trusted actor/session and normalized user-agent metadata are injected by
 * Platform API and must never be accepted from the browser body.
 */
export interface InternalUpsertWebPushSubscriptionInput
  extends UpsertWebPushSubscriptionInput {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly browser: WebPushBrowser;
  readonly platform: WebPushPlatform;
}

export interface RenameWebPushDeviceInput {
  readonly label: string;
}

export interface InternalRenameWebPushDeviceInput
  extends RenameWebPushDeviceInput {
  readonly userId: string;
  readonly version: number;
}

export interface WebPushRevokeResult {
  readonly installationId: string;
  readonly status: "REVOKED";
  /** False only when the subscription was already revoked. */
  readonly revoked: boolean;
}
