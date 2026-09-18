#!/bin/sh

set -eu

token_names="
PLATFORM_API_TO_SEO_DATA_TOKEN
PLATFORM_API_TO_JOBS_TOKEN
JOBS_TO_SEO_DATA_TOKEN
PLATFORM_API_TO_REALTIME_TOKEN
PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN
PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN
REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN
JOBS_TO_SEO_RANK_TOKEN
JOBS_TO_PLATFORM_RANK_GRANT_TOKEN
JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN
JOBS_TO_PLATFORM_AUTOMATION_TOKEN
JOBS_TO_SEO_RANK_RESULT_TOKEN
JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN
RANK_HISTORY_CURSOR_KEY
OPERATIONAL_ALERT_TOKEN
REDIS_JOBS_API_PASSWORD
REDIS_JOBS_SYSTEM_PASSWORD
REDIS_JOBS_INSPECTION_PASSWORD
REDIS_JOBS_IMPORT_PASSWORD
REDIS_JOBS_RANK_PASSWORD
REDIS_JOBS_CRAWL_PASSWORD
REDIS_JOBS_CONNECTOR_PASSWORD
REDIS_REALTIME_PASSWORD
NATS_RUNTIME_PASSWORD
NATS_PLATFORM_PUBLISHER_PASSWORD
NATS_REALTIME_CONSUMER_PASSWORD
NATS_AUTH_EMAIL_CONSUMER_PASSWORD
NATS_PROVISIONER_PASSWORD
"

nats_password_names="
NATS_RUNTIME_PASSWORD
NATS_PLATFORM_PUBLISHER_PASSWORD
NATS_REALTIME_CONSUMER_PASSWORD
NATS_AUTH_EMAIL_CONSUMER_PASSWORD
NATS_PROVISIONER_PASSWORD
"

username_names="
NATS_RUNTIME_USER
NATS_PLATFORM_PUBLISHER_USER
NATS_REALTIME_CONSUMER_USER
NATS_AUTH_EMAIL_CONSUMER_USER
NATS_PROVISIONER_USER
"

nats_password_hash_names="
NATS_RUNTIME_PASSWORD_HASH
NATS_PLATFORM_PUBLISHER_PASSWORD_HASH
NATS_REALTIME_CONSUMER_PASSWORD_HASH
NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH
NATS_PROVISIONER_PASSWORD_HASH
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

validated_nats_hashes=""
validated_nats_hash_count=0

for hash_name in $nats_password_hash_names; do
  if ! printenv "$hash_name" >/dev/null; then
    echo "service-token-preflight: $hash_name is required" >&2
    exit 1
  fi
  hash_value="$(printenv "$hash_name"; printf 'x')"
  hash_value=${hash_value%x}
  hash_value=${hash_value%?}

  # Older Dokploy releases consumed doubled dollars while writing their
  # unquoted Compose .env file. Newer releases quote and escape every dollar,
  # so the exact same stored value can reach the container still doubled.
  # Accept only that exact transport representation and canonicalize it before
  # applying the security checks below.
  case "$hash_value" in
    '$$2a$$11$$'*)
      hash_value='$2a$11$'"${hash_value#'$$2a$$11$$'}"
      ;;
  esac

  if ! printf '%s' "$hash_value" | grep -Eq '^\$2a\$11\$[./A-Za-z0-9]{53}$'; then
    echo "service-token-preflight: $hash_name must be a canonical NATS bcrypt 2a cost-11 verifier" >&2
    exit 1
  fi

  for previous_hash_name in $validated_nats_hashes; do
    previous_hash_value="$(printenv "$previous_hash_name"; printf 'x')"
    previous_hash_value=${previous_hash_value%x}
    previous_hash_value=${previous_hash_value%?}
    case "$previous_hash_value" in
      '$$2a$$11$$'*)
        previous_hash_value='$2a$11$'"${previous_hash_value#'$$2a$$11$$'}"
        ;;
    esac
    if [ "$hash_value" = "$previous_hash_value" ]; then
      echo "service-token-preflight: $hash_name must differ from $previous_hash_name" >&2
      exit 1
    fi
    unset previous_hash_value
  done

  validated_nats_hashes="$validated_nats_hashes $hash_name"
  validated_nats_hash_count=$((validated_nats_hash_count + 1))
  unset hash_value
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

for smtp_name in AUTH_EMAIL_SMTP_USER AUTH_EMAIL_SMTP_PASSWORD; do
  if ! printenv "$smtp_name" >/dev/null; then
    echo "service-token-preflight: $smtp_name is required" >&2
    exit 1
  fi
done

auth_email_smtp_user="$(printenv AUTH_EMAIL_SMTP_USER; printf 'x')"
auth_email_smtp_user=${auth_email_smtp_user%x}
auth_email_smtp_user=${auth_email_smtp_user%?}
auth_email_smtp_password="$(printenv AUTH_EMAIL_SMTP_PASSWORD; printf 'x')"
auth_email_smtp_password=${auth_email_smtp_password%x}
auth_email_smtp_password=${auth_email_smtp_password%?}

if [ -z "$auth_email_smtp_user" ] || [ ${#auth_email_smtp_user} -gt 320 ]; then
  echo "service-token-preflight: AUTH_EMAIL_SMTP_USER must contain 1..320 characters" >&2
  exit 1
fi
if [ -z "$auth_email_smtp_password" ] || [ ${#auth_email_smtp_password} -gt 1024 ]; then
  echo "service-token-preflight: AUTH_EMAIL_SMTP_PASSWORD must contain 1..1024 characters" >&2
  exit 1
fi
for credential_name in $token_names; do
  credential_value="$(printenv "$credential_name")"
  if [ "$auth_email_smtp_password" = "$credential_value" ]; then
    echo "service-token-preflight: AUTH_EMAIL_SMTP_PASSWORD must differ from $credential_name" >&2
    exit 1
  fi
  unset credential_value
done

unset auth_email_smtp_user auth_email_smtp_password
unset smtp_name

validated_platform_providers=0
validated_provider_secret_values=""

for provider_name in XMLSTOCK ARSENKIN; do
  enabled_name="PLATFORM_${provider_name}_ENABLED"
  price_name="PLATFORM_${provider_name}_RANK_KEYWORD_PRICE_MINOR"
  daily_budget_name="PLATFORM_${provider_name}_DAILY_SPEND_LIMIT_MINOR"
  monthly_budget_name="PLATFORM_${provider_name}_MONTHLY_SPEND_LIMIT_MINOR"
  legacy_api_key_name="PLATFORM_${provider_name}_API_KEY"
  pool_api_key_name="PLATFORM_${provider_name}_API_KEYS"

  if ! printenv "$enabled_name" >/dev/null; then
    echo "service-token-preflight: $enabled_name is required" >&2
    exit 1
  fi
  enabled_value="$(printenv "$enabled_name"; printf 'x')"
  enabled_value=${enabled_value%x}
  enabled_value=${enabled_value%?}
  case "$enabled_value" in
    true|false) ;;
    *)
      echo "service-token-preflight: $enabled_name must be true or false" >&2
      exit 1
      ;;
  esac

  if [ "$enabled_value" = false ]; then
    unset enabled_name enabled_value price_name daily_budget_name monthly_budget_name legacy_api_key_name pool_api_key_name
    continue
  fi

  if ! printenv "$price_name" >/dev/null; then
    echo "service-token-preflight: $price_name is required when $enabled_name=true" >&2
    exit 1
  fi

  price_value="$(printenv "$price_name"; printf 'x')"
  price_value=${price_value%x}
  price_value=${price_value%?}
  # 61,489,146,912 * 15,000 keywords * 10,000 micro/minor fits BIGINT.
  if ! printf '%s' "$price_value" | grep -Eq '^[0-9]{1,11}$' ||
    [ "$price_value" -lt 1 ] ||
    [ "$price_value" -gt 61489146912 ]; then
    echo "service-token-preflight: $price_name must be a positive safe integer no greater than 61489146912" >&2
    exit 1
  fi

  for budget_name in "$daily_budget_name" "$monthly_budget_name"; do
    if ! printenv "$budget_name" >/dev/null; then
      echo "service-token-preflight: $budget_name is required when $enabled_name=true" >&2
      exit 1
    fi
    budget_value="$(printenv "$budget_name"; printf 'x')"
    budget_value=${budget_value%x}
    budget_value=${budget_value%?}
    if [ -z "$budget_value" ]; then
      echo "service-token-preflight: $budget_name is required when $enabled_name=true" >&2
      exit 1
    fi
    if ! printf '%s' "$budget_value" | grep -Eq '^[0-9]{1,16}$' ||
      [ "$budget_value" -lt 1 ] ||
      [ "$budget_value" -gt 9007199254740991 ]; then
      echo "service-token-preflight: $budget_name must be a positive safe integer" >&2
      exit 1
    fi
    if [ "$budget_name" = "$daily_budget_name" ]; then
      daily_budget_value=$budget_value
    else
      monthly_budget_value=$budget_value
    fi
  done
  if [ "$monthly_budget_value" -lt "$daily_budget_value" ]; then
    echo "service-token-preflight: $monthly_budget_name must be greater than or equal to $daily_budget_name" >&2
    exit 1
  fi

  legacy_api_key_value="$(printenv "$legacy_api_key_name" 2>/dev/null || true; printf 'x')"
  legacy_api_key_value=${legacy_api_key_value%x}
  legacy_api_key_value=${legacy_api_key_value%?}
  pool_api_key_value="$(printenv "$pool_api_key_name" 2>/dev/null || true; printf 'x')"
  pool_api_key_value=${pool_api_key_value%x}
  pool_api_key_value=${pool_api_key_value%?}
  if [ -n "$legacy_api_key_value" ] && [ -n "$pool_api_key_value" ]; then
    echo "service-token-preflight: $pool_api_key_name conflicts with legacy $legacy_api_key_name" >&2
    exit 1
  fi
  if [ -n "$pool_api_key_value" ]; then
    api_key_name=$pool_api_key_name
    api_keys_value=$pool_api_key_value
  elif [ -n "$legacy_api_key_value" ]; then
    api_key_name=$legacy_api_key_name
    api_keys_value=$legacy_api_key_value
  else
    echo "service-token-preflight: $pool_api_key_name is required when $enabled_name=true" >&2
    exit 1
  fi
  case "$api_keys_value" in
    ,*|*,|*,,*)
      echo "service-token-preflight: $api_key_name must be a comma-separated list without empty items" >&2
      exit 1
      ;;
  esac
  if [ "$api_key_name" = "$legacy_api_key_name" ]; then
    case "$api_keys_value" in
      *,*)
        echo "service-token-preflight: $legacy_api_key_name must not contain commas" >&2
        exit 1
        ;;
    esac
  fi

  old_ifs=$IFS
  if [ "$api_key_name" = "$legacy_api_key_name" ]; then
    set -- "$api_keys_value"
  else
    IFS=,
    set -f
    set -- $api_keys_value
    set +f
  fi
  IFS=$old_ifs
  if [ "$#" -lt 1 ] || [ "$#" -gt 64 ]; then
    echo "service-token-preflight: $api_key_name must contain 1..64 keys" >&2
    exit 1
  fi
  api_key_count=$#
  for raw_api_key_value in "$@"; do
    api_key_value="$(printf '%s' "$raw_api_key_value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    api_key_length=${#api_key_value}
    # POSIX only guarantees interval expressions up to RE_DUP_MAX (255).
    # Alpine's grep therefore rejects {8,2048} as a malformed expression
    # before it can inspect an otherwise valid provider key. Bound the value
    # in the shell and let grep validate only the visible ASCII alphabet.
    if [ "$api_key_length" -lt 8 ] ||
      [ "$api_key_length" -gt 2048 ] ||
      ! LC_ALL=C printf '%s' "$api_key_value" | grep -Eq '^[!-~]+$'; then
      echo "service-token-preflight: $api_key_name items must contain 8..2048 visible ASCII characters without whitespace" >&2
      exit 1
    fi
    for credential_name in $token_names; do
      credential_value="$(printenv "$credential_name")"
      if [ "$api_key_value" = "$credential_value" ]; then
        echo "service-token-preflight: $api_key_name must differ from $credential_name" >&2
        exit 1
      fi
      unset credential_value
    done
    set -f
    for previous_provider_secret in $validated_provider_secret_values; do
      if [ "$api_key_value" = "$previous_provider_secret" ]; then
        echo "service-token-preflight: platform provider API keys must be distinct" >&2
        exit 1
      fi
    done
    set +f
    validated_provider_secret_values="$validated_provider_secret_values $api_key_value"
    unset api_key_length api_key_value raw_api_key_value
  done

  if [ "$provider_name" = XMLSTOCK ]; then
    legacy_account_name=PLATFORM_XMLSTOCK_ACCOUNT_ID
    pool_account_name=PLATFORM_XMLSTOCK_ACCOUNT_IDS
    legacy_account_value="$(printenv "$legacy_account_name" 2>/dev/null || true; printf 'x')"
    legacy_account_value=${legacy_account_value%x}
    legacy_account_value=${legacy_account_value%?}
    pool_account_value="$(printenv "$pool_account_name" 2>/dev/null || true; printf 'x')"
    pool_account_value=${pool_account_value%x}
    pool_account_value=${pool_account_value%?}
    if [ -n "$legacy_account_value" ] && [ -n "$pool_account_value" ]; then
      echo "service-token-preflight: $pool_account_name conflicts with legacy $legacy_account_name" >&2
      exit 1
    fi
    if [ -n "$pool_account_value" ]; then
      account_name=$pool_account_name
      account_values=$pool_account_value
    elif [ -n "$legacy_account_value" ]; then
      account_name=$legacy_account_name
      account_values=$legacy_account_value
    else
      echo "service-token-preflight: $pool_account_name is required when $enabled_name=true" >&2
      exit 1
    fi
    case "$account_values" in
      ,*|*,|*,,*)
        echo "service-token-preflight: $account_name must be a comma-separated list without empty items" >&2
        exit 1
        ;;
    esac
    if [ "$account_name" = "$legacy_account_name" ]; then
      case "$account_values" in
        *,*)
          echo "service-token-preflight: $legacy_account_name must not contain commas" >&2
          exit 1
          ;;
      esac
    fi
    old_ifs=$IFS
    if [ "$account_name" = "$legacy_account_name" ]; then
      set -- "$account_values"
    else
      IFS=,
      set -f
      set -- $account_values
      set +f
    fi
    IFS=$old_ifs
    if [ "$#" -ne "$api_key_count" ]; then
      echo "service-token-preflight: $account_name must contain exactly one identifier per API key in the same order" >&2
      exit 1
    fi
    validated_account_values=
    for raw_account_value in "$@"; do
      account_value="$(printf '%s' "$raw_account_value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      account_value_length=${#account_value}
      if [ "$account_value_length" -lt 1 ] ||
        [ "$account_value_length" -gt 255 ] ||
        ! LC_ALL=C printf '%s' "$account_value" | grep -Eq '^[ -~]+$' ||
        [ -z "$(printf '%s' "$account_value" | tr -d '[:space:]')" ]; then
        echo "service-token-preflight: $account_name items must be bounded printable identifiers" >&2
        exit 1
      fi
      if [ -n "$validated_account_values" ] &&
        printf '%s\n' "$validated_account_values" | grep -Fqx "x$account_value"; then
        echo "service-token-preflight: $account_name must not contain duplicate identifiers" >&2
        exit 1
      fi
      if [ -n "$validated_account_values" ]; then
        validated_account_values="$validated_account_values
x$account_value"
      else
        validated_account_values="x$account_value"
      fi
    done
    unset account_name account_value account_value_length account_values legacy_account_name legacy_account_value pool_account_name pool_account_value raw_account_value validated_account_values
  fi

  validated_platform_providers=$((validated_platform_providers + 1))
  unset enabled_name enabled_value price_name price_value daily_budget_name daily_budget_value monthly_budget_name monthly_budget_value budget_name budget_value api_key_name api_keys_value api_key_count legacy_api_key_name legacy_api_key_value pool_api_key_name pool_api_key_value old_ifs
done

echo "service-token-preflight: validated $validated_count distinct deploy credentials, $validated_nats_hash_count distinct NATS bcrypt verifiers, $validated_username_count distinct NATS usernames and $validated_platform_providers enabled platform providers; auth-email SMTP and provider credentials are isolated"
