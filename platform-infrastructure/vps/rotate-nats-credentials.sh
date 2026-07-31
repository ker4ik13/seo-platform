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

temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM
: > "$temporary_env_file"
chmod 600 "$temporary_env_file"

for nats_role in \
  RUNTIME \
  PLATFORM_PUBLISHER \
  REALTIME_CONSUMER \
  AUTH_EMAIL_CONSUMER \
  PROVISIONER
do
  nats_password="n$(openssl rand -hex 32)"
  printf -v "ROTATED_NATS_${nats_role}_PASSWORD" '%s' "$nats_password"
  nats_hash=$(
    printf '%s' "$nats_password" |
      python3 -c \
        'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(rounds=11, prefix=b"2a")).decode())'
  )
  printf -v "ROTATED_NATS_${nats_role}_PASSWORD_HASH" '%s' "$nats_hash"
  unset nats_password nats_hash
done

while IFS= read -r environment_line || [ -n "$environment_line" ]; do
  environment_name=${environment_line%%=*}
  replacement_value=
  case "$environment_name" in
    NATS_RUNTIME_PASSWORD)
      replacement_value=$ROTATED_NATS_RUNTIME_PASSWORD
      ;;
    NATS_RUNTIME_PASSWORD_HASH)
      replacement_value=$ROTATED_NATS_RUNTIME_PASSWORD_HASH
      ;;
    NATS_PLATFORM_PUBLISHER_PASSWORD)
      replacement_value=$ROTATED_NATS_PLATFORM_PUBLISHER_PASSWORD
      ;;
    NATS_PLATFORM_PUBLISHER_PASSWORD_HASH)
      replacement_value=$ROTATED_NATS_PLATFORM_PUBLISHER_PASSWORD_HASH
      ;;
    NATS_REALTIME_CONSUMER_PASSWORD)
      replacement_value=$ROTATED_NATS_REALTIME_CONSUMER_PASSWORD
      ;;
    NATS_REALTIME_CONSUMER_PASSWORD_HASH)
      replacement_value=$ROTATED_NATS_REALTIME_CONSUMER_PASSWORD_HASH
      ;;
    NATS_AUTH_EMAIL_CONSUMER_PASSWORD)
      replacement_value=$ROTATED_NATS_AUTH_EMAIL_CONSUMER_PASSWORD
      ;;
    NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH)
      replacement_value=$ROTATED_NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH
      ;;
    NATS_PROVISIONER_PASSWORD)
      replacement_value=$ROTATED_NATS_PROVISIONER_PASSWORD
      ;;
    NATS_PROVISIONER_PASSWORD_HASH)
      replacement_value=$ROTATED_NATS_PROVISIONER_PASSWORD_HASH
      ;;
  esac

  if [ -n "$replacement_value" ]; then
    printf "%s='%s'\n" "$environment_name" "$replacement_value"
  else
    printf '%s\n' "$environment_line"
  fi
done < "$runtime_env_file" > "$temporary_env_file"

mv "$temporary_env_file" "$runtime_env_file"
trap - EXIT INT TERM
chmod 600 "$runtime_env_file"

unset \
  ROTATED_NATS_RUNTIME_PASSWORD \
  ROTATED_NATS_RUNTIME_PASSWORD_HASH \
  ROTATED_NATS_PLATFORM_PUBLISHER_PASSWORD \
  ROTATED_NATS_PLATFORM_PUBLISHER_PASSWORD_HASH \
  ROTATED_NATS_REALTIME_CONSUMER_PASSWORD \
  ROTATED_NATS_REALTIME_CONSUMER_PASSWORD_HASH \
  ROTATED_NATS_AUTH_EMAIL_CONSUMER_PASSWORD \
  ROTATED_NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH \
  ROTATED_NATS_PROVISIONER_PASSWORD \
  ROTATED_NATS_PROVISIONER_PASSWORD_HASH \
  replacement_value environment_line environment_name

printf '%s\n' "seo-platform-vps: NATS client credentials rotated"
