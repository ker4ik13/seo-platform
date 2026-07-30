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

  lowercase_value="$(printf '%s' "$token_value" | tr '[:upper:]' '[:lower:]')"
  case "$lowercase_value" in
    replace-me|replace-with-*|example|example-*|change-me|changeme|your-*|your_*)
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

echo "service-token-preflight: validated $validated_count distinct deploy credentials"
