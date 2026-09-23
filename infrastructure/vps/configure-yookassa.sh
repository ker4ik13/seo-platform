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
  runtime_fail "stop $runtime_session before changing YooKassa credentials"

shop_id=${SEO_PLATFORM_YOOKASSA_SHOP_ID:-${YOOKASSA_SHOP_ID:-}}
case "$shop_id" in
  ''|*[!0-9]*) runtime_fail "SEO_PLATFORM_YOOKASSA_SHOP_ID must contain digits only" ;;
esac

secret_key=${YOOKASSA_SECRET_KEY:-}
if [ -t 0 ]; then
  printf 'YooKassa secret key (leave empty to keep the current value): ' >&2
  IFS= read -r -s entered_secret
  printf '\n' >&2
  if [ -n "$entered_secret" ]; then
    secret_key=$entered_secret
  fi
fi
[ -n "$secret_key" ] || runtime_fail "YooKassa secret key is required on stdin"
case "$secret_key" in
  *"'"*|*$'\n'*|*$'\r'*) runtime_fail "YooKassa secret key contains unsupported characters" ;;
esac

return_url=${SEO_PLATFORM_PUBLIC_URL%/}/app/settings/billing?checkout=return
temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    YOOKASSA_ENABLED=*|YOOKASSA_SHOP_ID=*|YOOKASSA_SECRET_KEY=*|YOOKASSA_RETURN_URL=*|YOOKASSA_API_BASE_URL=*|YOOKASSA_REQUEST_TIMEOUT_MS=*|YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP=*|BILLING_RECONCILIATION_ENABLED=*|BILLING_RECONCILIATION_INTERVAL_MS=*|BILLING_RECONCILIATION_BATCH_SIZE=*) ;;
    *) printf '%s\n' "$line" >> "$temporary_env_file" ;;
  esac
done < "$runtime_env_file"

write_value() {
  local name=$1
  local value=$2
  case "$value" in
    *"'"*|*$'\n'*|*$'\r'*) runtime_fail "unsafe YooKassa environment value" ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$temporary_env_file"
}

write_value YOOKASSA_ENABLED true
write_value YOOKASSA_SHOP_ID "$shop_id"
write_value YOOKASSA_SECRET_KEY "$secret_key"
write_value YOOKASSA_RETURN_URL "$return_url"
write_value YOOKASSA_API_BASE_URL https://api.yookassa.ru/v3
write_value YOOKASSA_REQUEST_TIMEOUT_MS 10000
write_value YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP true
write_value BILLING_RECONCILIATION_ENABLED true
write_value BILLING_RECONCILIATION_INTERVAL_MS 60000
write_value BILLING_RECONCILIATION_BATCH_SIZE 50

chmod 600 "$temporary_env_file"
mv "$temporary_env_file" "$runtime_env_file"
temporary_env_file=
trap - EXIT INT TERM

printf '%s\n' \
  "seo-platform-vps: YooKassa and mandatory reconciliation are configured" \
  "seo-platform-vps: merchant secret remains only in runtime.env (mode 600)"
