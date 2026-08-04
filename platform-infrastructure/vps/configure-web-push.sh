#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

load_runtime_environment

tmux has-session -t "$runtime_session" 2>/dev/null &&
  runtime_fail "stop $runtime_session before changing Web Push keys"

node_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/node
[ -x "$node_bin" ] || runtime_fail "Node.js runtime is missing"

vapid_public_key=${WEB_PUSH_VAPID_PUBLIC_KEY:-}
vapid_private_key=${WEB_PUSH_VAPID_PRIVATE_KEY:-}
if { [ -n "$vapid_public_key" ] && [ -z "$vapid_private_key" ]; } ||
  { [ -z "$vapid_public_key" ] && [ -n "$vapid_private_key" ]; }
then
  runtime_fail "existing VAPID key pair is incomplete; refusing implicit rotation"
fi
if [ -z "$vapid_public_key" ]; then
  mapfile -t vapid_pair < <(
    "$node_bin" --input-type=module -e '
      import { createECDH } from "node:crypto";
      const key = createECDH("prime256v1");
      key.generateKeys();
      process.stdout.write(`${key.getPublicKey(undefined, "uncompressed").toString("base64url")}\n${key.getPrivateKey().toString("base64url")}\n`);
    '
  )
  [ "${#vapid_pair[@]}" -eq 2 ] || runtime_fail "failed to generate VAPID key pair"
  vapid_public_key=${vapid_pair[0]}
  vapid_private_key=${vapid_pair[1]}
fi

subscription_keyring=${WEB_PUSH_SUBSCRIPTION_KEYS:-}
fingerprint_keyring=${WEB_PUSH_FINGERPRINT_KEYS:-}
subscription_key=${subscription_keyring#*:}
fingerprint_key=${fingerprint_keyring#*:}
if [ -z "$subscription_keyring" ]; then
  subscription_key=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
fi
if [ -z "$fingerprint_keyring" ]; then
  fingerprint_key=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
fi
[ "$subscription_key" != "$fingerprint_key" ] ||
  runtime_fail "Web Push encryption and fingerprint keys must differ"

vapid_subject=${SEO_PLATFORM_WEB_PUSH_SUBJECT:-${WEB_PUSH_VAPID_SUBJECT:-mailto:webpush-preview@example.com}}
endpoint_origins=${WEB_PUSH_ENDPOINT_ORIGINS:-https://fcm.googleapis.com,https://updates.push.services.mozilla.com,https://web.push.apple.com}
temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    WEB_PUSH_REGISTRATION_ENABLED=*|WEB_PUSH_DELIVERY_AVAILABLE=*|WEB_PUSH_DELIVERY_ENABLED=*|WEB_PUSH_VAPID_PUBLIC_KEY=*|WEB_PUSH_VAPID_PRIVATE_KEY=*|WEB_PUSH_VAPID_SUBJECT=*|WEB_PUSH_VAPID_KEY_VERSION=*|WEB_PUSH_ENDPOINT_ORIGINS=*|WEB_PUSH_SUBSCRIPTION_KEYS=*|WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION=*|WEB_PUSH_FINGERPRINT_KEYS=*|WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION=*) ;;
    *) printf '%s\n' "$line" >> "$temporary_env_file" ;;
  esac
done < "$runtime_env_file"

write_value() {
  local name=$1
  local value=$2
  case "$value" in
    *"'"*|*$'\n'*|*$'\r'*) runtime_fail "unsafe Web Push environment value" ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$temporary_env_file"
}

write_value WEB_PUSH_REGISTRATION_ENABLED true
write_value WEB_PUSH_DELIVERY_AVAILABLE true
write_value WEB_PUSH_DELIVERY_ENABLED true
write_value WEB_PUSH_VAPID_PUBLIC_KEY "$vapid_public_key"
write_value WEB_PUSH_VAPID_PRIVATE_KEY "$vapid_private_key"
write_value WEB_PUSH_VAPID_SUBJECT "$vapid_subject"
write_value WEB_PUSH_VAPID_KEY_VERSION 1
write_value WEB_PUSH_ENDPOINT_ORIGINS "$endpoint_origins"
write_value WEB_PUSH_SUBSCRIPTION_KEYS "1:$subscription_key"
write_value WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION 1
write_value WEB_PUSH_FINGERPRINT_KEYS "1:$fingerprint_key"
write_value WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION 1

chmod 600 "$temporary_env_file"
mv "$temporary_env_file" "$runtime_env_file"
temporary_env_file=
trap - EXIT INT TERM

printf '%s\n' \
  "seo-platform-vps: Web Push registration and isolated delivery are configured" \
  "seo-platform-vps: generated keys remain only in runtime.env (mode 600)"
