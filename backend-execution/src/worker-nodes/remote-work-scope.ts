import { createHash } from "node:crypto";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";

/** Pins encrypted material without retaining or exposing the API key. */
export function remoteCredentialFingerprint(value:EncryptedIntegrationCredential):string {
  return createHash("sha256").update(value.nonce).update(value.ciphertext).digest("hex");
}
