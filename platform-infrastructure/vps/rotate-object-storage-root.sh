#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

assert_runtime_root
[ -f "$runtime_env_file" ] ||
  runtime_fail "runtime.env is missing"

new_password=$(openssl rand -hex 32)
temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM
: > "$temporary_env_file"
chmod 600 "$temporary_env_file"
replaced=false
while IFS= read -r line; do
  case "$line" in
    MINIO_ROOT_PASSWORD=*)
      printf "MINIO_ROOT_PASSWORD='%s'\n" "$new_password" \
        >> "$temporary_env_file"
      replaced=true
      ;;
    *)
      printf '%s\n' "$line" >> "$temporary_env_file"
      ;;
  esac
done < "$runtime_env_file"
[ "$replaced" = true ] ||
  runtime_fail "MINIO_ROOT_PASSWORD is missing"
mv "$temporary_env_file" "$runtime_env_file"
temporary_env_file=
trap - EXIT INT TERM
chmod 600 "$runtime_env_file"
unset new_password

printf '%s\n' \
  "seo-platform-vps: object-storage root credential rotated; restart runtime to apply"
