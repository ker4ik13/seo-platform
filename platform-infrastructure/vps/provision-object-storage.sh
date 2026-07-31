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

[ -x "$runtime_root/bin/mc" ] ||
  runtime_fail "MinIO client is not installed"

mc_config_dir=$runtime_root/object-storage/mc
policy_file=$runtime_root/object-storage/app-policy.json
mkdir -p "$mc_config_dir"
chmod 700 "$mc_config_dir"
case "$S3_BUCKET_UPLOADS$S3_BUCKET_ARTIFACTS" in
  *[!a-z0-9.-]*) runtime_fail "S3 bucket names are unsafe" ;;
esac
sed \
  -e "s/__S3_BUCKET_UPLOADS__/$S3_BUCKET_UPLOADS/g" \
  -e "s/__S3_BUCKET_ARTIFACTS__/$S3_BUCKET_ARTIFACTS/g" \
  "$script_dir/minio-app-policy.json" \
  > "$policy_file"
chmod 600 "$policy_file"

mc_command() {
  env \
    -i \
    PATH="$runtime_root/bin:/usr/bin:/bin" \
    MC_CONFIG_DIR="$mc_config_dir" \
    "$runtime_root/bin/mc" "$@"
}

mc_command alias set \
  local \
  http://127.0.0.1:9000 \
  "$MINIO_ROOT_USER" \
  "$MINIO_ROOT_PASSWORD" >/dev/null

for bucket in "$S3_BUCKET_UPLOADS" "$S3_BUCKET_ARTIFACTS"; do
  mc_command mb --ignore-existing "local/$bucket" >/dev/null
  mc_command version enable "local/$bucket" >/dev/null
done

if ! mc_command admin user info local "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc_command admin user add \
    local \
    "$S3_ACCESS_KEY_ID" \
    "$S3_SECRET_ACCESS_KEY" >/dev/null
fi

mc_command admin policy create \
  local \
  seo-platform-storage \
  "$policy_file" >/dev/null
mc_command admin policy attach \
  local \
  seo-platform-storage \
  --user "$S3_ACCESS_KEY_ID" >/dev/null

printf '%s\n' "seo-platform-vps: object storage is provisioned"
