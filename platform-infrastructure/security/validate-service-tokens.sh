#!/bin/sh

set -eu

token_names="
PLATFORM_API_TO_SEO_DATA_TOKEN
PLATFORM_API_TO_JOBS_TOKEN
JOBS_TO_SEO_DATA_TOKEN
PLATFORM_API_TO_REALTIME_TOKEN
PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN
PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN
JOBS_TO_SEO_RANK_TOKEN
JOBS_TO_PLATFORM_RANK_GRANT_TOKEN
JOBS_TO_SEO_RANK_RESULT_TOKEN
RANK_HISTORY_CURSOR_KEY
REDIS_JOBS_API_PASSWORD
REDIS_JOBS_SYSTEM_PASSWORD
REDIS_JOBS_INSPECTION_PASSWORD
REDIS_JOBS_IMPORT_PASSWORD
REDIS_JOBS_RANK_PASSWORD
REDIS_JOBS_CONNECTOR_PASSWORD
REDIS_REALTIME_PASSWORD
REDIS_DIRECTUS_PASSWORD
NATS_RUNTIME_PASSWORD
NATS_PLATFORM_PUBLISHER_PASSWORD
NATS_REALTIME_CONSUMER_PASSWORD
NATS_PROVISIONER_PASSWORD
"

nats_password_names="
NATS_RUNTIME_PASSWORD
NATS_PLATFORM_PUBLISHER_PASSWORD
NATS_REALTIME_CONSUMER_PASSWORD
NATS_PROVISIONER_PASSWORD
"

username_names="
NATS_RUNTIME_USER
NATS_PLATFORM_PUBLISHER_USER
NATS_REALTIME_CONSUMER_USER
NATS_PROVISIONER_USER
"

validated_names=""
validated_count=0

for token_name in $token_names; do
  if ! printenv "$token_name" >/dev/null; then
    echo "service-token-preflight: $token_name is required" >&2
    exit 1
  fi
  # The sentinel preserves value newlines; then remove it and printenv's delimiter.
  token_value="$(printenv "$token_name"; printf 'x')"
  token_value=${token_value%x}
  token_value=${token_value%?}

  token_length=${#token_value}
  if [ "$token_length" -lt 32 ] || [ "$token_length" -gt 512 ]; then
    echo "service-token-preflight: $token_name must contain 32..512 characters" >&2
    exit 1
  fi

  case "$token_value" in
    *[!-A-Za-z0-9._~]*)
      echo "service-token-preflight: $token_name must be URL-safe" >&2
      exit 1
      ;;
  esac

  is_nats_password=false
  for nats_password_name in $nats_password_names; do
    if [ "$token_name" = "$nats_password_name" ]; then
      is_nats_password=true
      break
    fi
  done
  if [ "$is_nats_password" = true ]; then
    case "$token_value" in
      [A-Za-z]*) ;;
      *)
        echo "service-token-preflight: $token_name must start with an ASCII letter" >&2
        exit 1
        ;;
    esac
  fi
  unset is_nats_password

  lowercase_value="$(printf '%s' "$token_value" | tr '[:upper:]' '[:lower:]')"
  case "$lowercase_value" in
    replace-*|change-*|changeme*|example*|dummy-*|placeholder*|test-*|your-*|your_*)
      echo "service-token-preflight: $token_name must not use an example placeholder" >&2
      exit 1
      ;;
  esac
  unset lowercase_value

  for previous_name in $validated_names; do
    previous_value="$(printenv "$previous_name")"
    if [ "$token_value" = "$previous_value" ]; then
      echo "service-token-preflight: $token_name must differ from $previous_name" >&2
      exit 1
    fi
    unset previous_value
  done

  validated_names="$validated_names $token_name"
  validated_count=$((validated_count + 1))
  unset token_value
done

validated_usernames=""
validated_username_count=0

for username_name in $username_names; do
  if ! printenv "$username_name" >/dev/null; then
    echo "service-token-preflight: $username_name is required" >&2
    exit 1
  fi
  username_value="$(printenv "$username_name"; printf 'x')"
  username_value=${username_value%x}
  username_value=${username_value%?}

  username_length=${#username_value}
  if [ "$username_length" -lt 3 ] || [ "$username_length" -gt 64 ]; then
    echo "service-token-preflight: $username_name must contain 3..64 characters" >&2
    exit 1
  fi

  case "$username_value" in
    [A-Za-z]*) ;;
    *)
      echo "service-token-preflight: $username_name must start with an ASCII letter" >&2
      exit 1
      ;;
  esac
  case "$username_value" in
    *[!A-Za-z0-9_-]*)
      echo "service-token-preflight: $username_name must be an ASCII identifier" >&2
      exit 1
      ;;
  esac

  lowercase_value="$(printf '%s' "$username_value" | tr '[:upper:]' '[:lower:]')"
  case "$lowercase_value" in
    user|username|example|example-*|replace-*|change-me|changeme|your-*|your_*)
      echo "service-token-preflight: $username_name must not use an example placeholder" >&2
      exit 1
      ;;
  esac
  unset lowercase_value

  for previous_name in $validated_usernames; do
    previous_value="$(printenv "$previous_name")"
    if [ "$username_value" = "$previous_value" ]; then
      echo "service-token-preflight: $username_name must differ from $previous_name" >&2
      exit 1
    fi
    unset previous_value
  done

  for credential_name in $token_names; do
    credential_value="$(printenv "$credential_name")"
    if [ "$username_value" = "$credential_value" ]; then
      echo "service-token-preflight: $username_name must differ from $credential_name" >&2
      exit 1
    fi
    unset credential_value
  done

  validated_usernames="$validated_usernames $username_name"
  validated_username_count=$((validated_username_count + 1))
  unset username_value
done

echo "service-token-preflight: validated $validated_count distinct deploy credentials and $validated_username_count distinct NATS usernames"
