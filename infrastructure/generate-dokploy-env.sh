#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
template_file="$project_root/.env.example"
output_file=${1:-"$project_root/.env.dokploy.generated"}

case "$output_file" in
  /*) ;;
  *) output_file="$PWD/$output_file" ;;
esac

output_parent=$(dirname -- "$output_file")
if [ ! -d "$output_parent" ]; then
  echo "dokploy-env: output directory does not exist: $output_parent" >&2
  exit 1
fi
if [ -e "$output_file" ]; then
  echo "dokploy-env: refusing to overwrite existing file: $output_file" >&2
  exit 1
fi
if [ ! -r "$template_file" ]; then
  echo "dokploy-env: canonical template is not readable: $template_file" >&2
  exit 1
fi

for required_command in openssl awk mktemp chmod ln rm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "dokploy-env: required command is missing: $required_command" >&2
    exit 1
  fi
done

bcrypt_python=${DOKPLOY_BCRYPT_PYTHON:-python3}
if ! command -v "$bcrypt_python" >/dev/null 2>&1 ||
  ! "$bcrypt_python" -c 'import bcrypt' >/dev/null 2>&1; then
  cat >&2 <<'EOF'
dokploy-env: Python bcrypt is required only to generate matching NATS hashes.
Prepare an isolated interpreter and repeat the command:

  python3 -m venv /tmp/seo-dokploy-secrets
  /tmp/seo-dokploy-secrets/bin/pip install bcrypt
  DOKPLOY_BCRYPT_PYTHON=/tmp/seo-dokploy-secrets/bin/python pnpm dokploy:env:generate
EOF
  exit 1
fi

temporary_directory=$(mktemp -d)
temporary_output=$(mktemp "$output_parent/.dokploy-env.XXXXXX")
cleanup() {
  if [ -n "${temporary_directory:-}" ]; then
    rm -rf -- "$temporary_directory"
  fi
  if [ -n "${temporary_output:-}" ]; then
    rm -f -- "$temporary_output"
  fi
}
trap cleanup EXIT INT TERM
overrides_file="$temporary_directory/overrides.env"
: > "$overrides_file"

random_url_safe_secret() {
  openssl rand -hex 32
}

random_base64url_key() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
}

bcrypt_verifier() {
  "$bcrypt_python" -c \
    'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(rounds=11, prefix=b"2a")).decode())'
}

write_override() {
  local name=$1
  local value=$2

  case "$name" in
    *[!A-Z0-9_]*)
      echo "dokploy-env: invalid variable name: $name" >&2
      exit 1
      ;;
  esac
  case "$value" in
    *$'\n'*|*$'\r'*)
      echo "dokploy-env: generated value for $name contains a newline" >&2
      exit 1
      ;;
  esac

  printf '%s=%s\n' "$name" "$value" >> "$overrides_file"
}

# Every name below receives a different value. The same variable is injected by
# Compose into all of its producer/consumer containers, so no second copy is
# generated for a matching runtime role.
for secret_name in \
  POSTGRES_PASSWORD \
  PLATFORM_DATABASE_OWNER_PASSWORD \
  PLATFORM_DATABASE_PASSWORD \
  SEO_DATABASE_OWNER_PASSWORD \
  SEO_DATABASE_PASSWORD \
  JOBS_DATABASE_OWNER_PASSWORD \
  JOBS_DATABASE_PASSWORD \
  JOBS_RANK_DATABASE_PASSWORD \
  JOBS_AUTH_EMAIL_DATABASE_PASSWORD \
  JOBS_CONNECTOR_DATABASE_PASSWORD \
  REALTIME_DATABASE_OWNER_PASSWORD \
  REALTIME_DATABASE_PASSWORD \
  REALTIME_WEB_PUSH_DATABASE_PASSWORD \
  REDIS_JOBS_API_PASSWORD \
  REDIS_JOBS_SYSTEM_PASSWORD \
  REDIS_JOBS_INSPECTION_PASSWORD \
  REDIS_JOBS_IMPORT_PASSWORD \
  REDIS_JOBS_RANK_PASSWORD \
  REDIS_JOBS_CRAWL_PASSWORD \
  REDIS_JOBS_CONNECTOR_PASSWORD \
  REDIS_REALTIME_PASSWORD \
  PLATFORM_API_TO_SEO_DATA_TOKEN \
  PLATFORM_API_TO_JOBS_TOKEN \
  JOBS_TO_SEO_DATA_TOKEN \
  PLATFORM_API_TO_REALTIME_TOKEN \
  JOBS_TO_SEO_RANK_TOKEN \
  JOBS_TO_PLATFORM_RANK_GRANT_TOKEN \
  JOBS_TO_PLATFORM_AUTOMATION_TOKEN \
  JOBS_TO_SEO_RANK_RESULT_TOKEN \
  JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN \
  RANK_HISTORY_CURSOR_KEY \
  PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN \
  PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN \
  REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN \
  AUTH_PASSWORD_PEPPER
do
  write_override "$secret_name" "$(random_url_safe_secret)"
done

write_override AUTH_DATA_ENCRYPTION_KEY "$(random_base64url_key)"
write_override \
  INTEGRATION_CREDENTIAL_KEYS \
  "1:$(random_base64url_key)"
write_override \
  INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS \
  "1:$(random_base64url_key)"

for nats_role in \
  RUNTIME \
  PLATFORM_PUBLISHER \
  REALTIME_CONSUMER \
  AUTH_EMAIL_CONSUMER \
  PROVISIONER
do
  nats_password="n$(random_url_safe_secret)"
  write_override "NATS_${nats_role}_PASSWORD" "$nats_password"
  nats_hash=$(printf '%s' "$nats_password" | bcrypt_verifier)
  # Dokploy parses the pasted block once and writes its own unquoted .env.
  # Double dollars survive that round-trip and Compose turns each pair back
  # into one literal dollar before the value reaches NATS/preflight.
  dokploy_hash=${nats_hash//\$/\$\$}
  write_override "NATS_${nats_role}_PASSWORD_HASH" "'$dokploy_hash'"
  unset nats_password nats_hash dokploy_hash
done

awk '
  NR == FNR {
    separator = index($0, "=")
    key = substr($0, 1, separator - 1)
    replacements[key] = substr($0, separator + 1)
    next
  }
  match($0, /^[A-Z][A-Z0-9_]*=/) {
    separator = index($0, "=")
    key = substr($0, 1, separator - 1)
    if (key in replacements) {
      print key "=" replacements[key]
      seen[key] = 1
      next
    }
  }
  { print }
  END {
    missing = 0
    for (key in replacements) {
      if (!(key in seen)) {
        print "dokploy-env: generated unknown variable " key > "/dev/stderr"
        missing = 1
      }
    }
    if (missing) {
      exit 2
    }
  }
' "$overrides_file" "$template_file" > "$temporary_output"

chmod 600 "$temporary_output"
if ! ln "$temporary_output" "$output_file"; then
  echo "dokploy-env: refusing to overwrite output created concurrently: $output_file" >&2
  exit 1
fi
rm -f -- "$temporary_output"
temporary_output=

variable_count=$(awk -F= '/^[A-Z][A-Z0-9_]*=/{count++} END{print count+0}' "$output_file")
manual_comment_count=$(grep -c '^# ВРУЧНУЮ' "$output_file" || true)

cat <<EOF
dokploy-env: generated unique internal secrets in:
  $output_file

The file contains all $variable_count environment variable lines and has mode
600. It is ignored by Git when the default name is used. Review only the
$manual_comment_count fields described by comments starting with # ВРУЧНУЮ.
Fill every empty field marked (обязательно); values for disabled YooKassa/Web
Push features may remain empty, and documented SMTP/S3 defaults may stay as is.

POSTGRES_PASSWORD is the only generated secret that must also be entered
manually outside Compose: use that exact value in every Dokploy PostgreSQL
backup job. NATS *_PASSWORD_HASH values are derived from the password directly
above them; hashes and plaintext passwords are intentionally not identical.
The generated hash lines contain doubled dollar signs for Dokploy's parse and
Compose interpolation round-trip; containers receive canonical single-dollar
bcrypt values.
EOF
