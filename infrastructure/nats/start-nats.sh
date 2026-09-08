#!/bin/sh
set -eu

template=${1:-/etc/nats/nats-server.conf}
runtime_directory=${2:-/run/nats-runtime}
runtime_config=$runtime_directory/nats-server.conf
temporary_config=${runtime_config}.tmp.$$

fail() {
  printf '%s\n' "nats-runtime-config: $1" >&2
  exit 1
}

cleanup() {
  if [ -n "$temporary_config" ] && [ -e "$temporary_config" ]; then
    rm -f "$temporary_config"
  fi
}

trap cleanup 0 1 2 15

if [ "$#" -gt 2 ]; then
  fail 'expected at most template and runtime-directory arguments'
fi
case "$template" in
  /*) ;;
  *) fail 'template path must be absolute' ;;
esac
case "$runtime_directory" in
  /*) ;;
  *) fail 'runtime directory must be absolute' ;;
esac
if [ ! -f "$template" ] || [ ! -r "$template" ]; then
  fail 'template must be a readable regular file'
fi
if [ "$template" = "$runtime_config" ]; then
  fail 'template and runtime config must be different files'
fi

umask 077
mkdir -p "$runtime_directory"
chmod 700 "$runtime_directory"

required_names='NATS_RUNTIME_USER
NATS_RUNTIME_PASSWORD_HASH
NATS_PLATFORM_PUBLISHER_USER
NATS_PLATFORM_PUBLISHER_PASSWORD_HASH
NATS_REALTIME_CONSUMER_USER
NATS_REALTIME_CONSUMER_PASSWORD_HASH
NATS_AUTH_EMAIL_CONSUMER_USER
NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH
NATS_PROVISIONER_USER
NATS_PROVISIONER_PASSWORD_HASH
NATS_IDENTITY_EVENT_SUBJECT
NATS_IDENTITY_EVENT_DLQ_SUBJECT
NATS_EMAIL_VERIFICATION_EVENT_SUBJECT
NATS_PASSWORD_RESET_EVENT_SUBJECT
NATS_WORKSPACE_INVITE_EVENT_SUBJECT
NATS_NPD_RECEIPT_EVENT_SUBJECT
NATS_AUTH_EMAIL_DLQ_SUBJECT'

for required_name in $required_names; do
  if ! printenv "$required_name" >/dev/null 2>&1; then
    fail "$required_name is required"
  fi
done

username_names='NATS_RUNTIME_USER
NATS_PLATFORM_PUBLISHER_USER
NATS_REALTIME_CONSUMER_USER
NATS_AUTH_EMAIL_CONSUMER_USER
NATS_PROVISIONER_USER'
hash_names='NATS_RUNTIME_PASSWORD_HASH
NATS_PLATFORM_PUBLISHER_PASSWORD_HASH
NATS_REALTIME_CONSUMER_PASSWORD_HASH
NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH
NATS_PROVISIONER_PASSWORD_HASH'
marker_names="$required_names"

for marker_name in $marker_names; do
  marker="__${marker_name}__"
  marker_count=$(
    awk -v marker="$marker" '
      {
        remaining = $0
        while ((position = index(remaining, marker)) > 0) {
          count += 1
          remaining = substr(remaining, position + length(marker))
        }
      }
      END { print count + 0 }
    ' "$template"
  )
  if [ "$marker_count" -ne 1 ]; then
    fail "template marker $marker_name must occur exactly once"
  fi
done

validated_usernames=''
for username_name in $username_names; do
  username_value=$(printenv "$username_name")
  if ! printf '%s' "$username_value" | grep -Eq '^[A-Za-z][A-Za-z0-9._~-]{2,63}$'; then
    fail "$username_name must be a canonical NATS username"
  fi
  for previous_name in $validated_usernames; do
    if [ "$username_value" = "$(printenv "$previous_name")" ]; then
      fail "$username_name must differ from $previous_name"
    fi
  done
  validated_usernames="$validated_usernames $username_name"
  unset username_value
done

validated_hashes=''
for hash_name in $hash_names; do
  hash_value=$(printenv "$hash_name")
  # Dokploy versions differ in how they round-trip dollars through the
  # generated Compose .env file. Normalize the generator's exact escaped
  # transport form, but keep rejecting mixed or otherwise malformed values.
  case "$hash_value" in
    '$$2a$$11$$'*)
      hash_value='$2a$11$'"${hash_value#'$$2a$$11$$'}"
      ;;
  esac
  if ! printf '%s' "$hash_value" | grep -Eq '^\$2a\$11\$[./A-Za-z0-9]{53}$'; then
    fail "$hash_name must be a canonical NATS bcrypt 2a cost-11 verifier"
  fi
  case "$hash_name" in
    NATS_RUNTIME_PASSWORD_HASH)
      NATS_RUNTIME_PASSWORD_HASH=$hash_value
      ;;
    NATS_PLATFORM_PUBLISHER_PASSWORD_HASH)
      NATS_PLATFORM_PUBLISHER_PASSWORD_HASH=$hash_value
      ;;
    NATS_REALTIME_CONSUMER_PASSWORD_HASH)
      NATS_REALTIME_CONSUMER_PASSWORD_HASH=$hash_value
      ;;
    NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH)
      NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH=$hash_value
      ;;
    NATS_PROVISIONER_PASSWORD_HASH)
      NATS_PROVISIONER_PASSWORD_HASH=$hash_value
      ;;
  esac
  for previous_name in $validated_hashes; do
    if [ "$hash_value" = "$(printenv "$previous_name")" ]; then
      fail "$hash_name must differ from $previous_name"
    fi
  done
  validated_hashes="$validated_hashes $hash_name"
  unset hash_value
done

identity_subject=$(printenv NATS_IDENTITY_EVENT_SUBJECT)
dlq_subject=$(printenv NATS_IDENTITY_EVENT_DLQ_SUBJECT)
email_verification_subject=$(printenv NATS_EMAIL_VERIFICATION_EVENT_SUBJECT)
password_reset_subject=$(printenv NATS_PASSWORD_RESET_EVENT_SUBJECT)
workspace_invite_subject=$(printenv NATS_WORKSPACE_INVITE_EVENT_SUBJECT)
npd_receipt_subject=$(printenv NATS_NPD_RECEIPT_EVENT_SUBJECT)
auth_email_dlq_subject=$(printenv NATS_AUTH_EMAIL_DLQ_SUBJECT)
if ! printf '%s' "$identity_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.identity\.session-family\.revoked\.v1$'; then
  fail 'NATS_IDENTITY_EVENT_SUBJECT is invalid'
fi
if ! printf '%s' "$dlq_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.dlq\.realtime\.identity\.session-family\.revoked\.v1$'; then
  fail 'NATS_IDENTITY_EVENT_DLQ_SUBJECT is invalid'
fi
if ! printf '%s' "$email_verification_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.email\.identity\.email-verification\.requested\.v1$'; then
  fail 'NATS_EMAIL_VERIFICATION_EVENT_SUBJECT is invalid'
fi
if ! printf '%s' "$password_reset_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.email\.identity\.password-reset\.requested\.v1$'; then
  fail 'NATS_PASSWORD_RESET_EVENT_SUBJECT is invalid'
fi
if ! printf '%s' "$workspace_invite_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.email\.workspace\.invite\.requested\.v1$'; then
  fail 'NATS_WORKSPACE_INVITE_EVENT_SUBJECT is invalid'
fi
if ! printf '%s' "$npd_receipt_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.email\.billing\.npd-receipt\.delivery-requested\.v1$'; then
  fail 'NATS_NPD_RECEIPT_EVENT_SUBJECT is invalid'
fi
if ! printf '%s' "$auth_email_dlq_subject" | grep -Eq '^[a-z][a-z0-9_-]{0,31}\.dlq\.jobs\.transactional-email\.v1$'; then
  fail 'NATS_AUTH_EMAIL_DLQ_SUBJECT is invalid'
fi
identity_environment=${identity_subject%.identity.session-family.revoked.v1}
dlq_environment=${dlq_subject%.dlq.realtime.identity.session-family.revoked.v1}
email_verification_environment=${email_verification_subject%.email.identity.email-verification.requested.v1}
password_reset_environment=${password_reset_subject%.email.identity.password-reset.requested.v1}
workspace_invite_environment=${workspace_invite_subject%.email.workspace.invite.requested.v1}
npd_receipt_environment=${npd_receipt_subject%.email.billing.npd-receipt.delivery-requested.v1}
auth_email_dlq_environment=${auth_email_dlq_subject%.dlq.jobs.transactional-email.v1}
for event_environment in \
  "$dlq_environment" \
  "$email_verification_environment" \
  "$password_reset_environment" \
  "$workspace_invite_environment" \
  "$npd_receipt_environment" \
  "$auth_email_dlq_environment"
do
  if [ "$identity_environment" != "$event_environment" ]; then
    fail 'NATS event and DLQ subjects must use the same environment'
  fi
done

: > "$temporary_config"
chmod 600 "$temporary_config"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '      user: "__NATS_RUNTIME_USER__"')
      printf '      user: "%s"\n' "$NATS_RUNTIME_USER"
      ;;
    '      password: "__NATS_RUNTIME_PASSWORD_HASH__"')
      printf '      password: "%s"\n' "$NATS_RUNTIME_PASSWORD_HASH"
      ;;
    '      user: "__NATS_PLATFORM_PUBLISHER_USER__"')
      printf '      user: "%s"\n' "$NATS_PLATFORM_PUBLISHER_USER"
      ;;
    '      password: "__NATS_PLATFORM_PUBLISHER_PASSWORD_HASH__"')
      printf '      password: "%s"\n' "$NATS_PLATFORM_PUBLISHER_PASSWORD_HASH"
      ;;
    '            "__NATS_IDENTITY_EVENT_SUBJECT__",')
      printf '            "%s",\n' "$identity_subject"
      ;;
    '            "__NATS_EMAIL_VERIFICATION_EVENT_SUBJECT__",')
      printf '            "%s",\n' "$email_verification_subject"
      ;;
    '            "__NATS_PASSWORD_RESET_EVENT_SUBJECT__",')
      printf '            "%s",\n' "$password_reset_subject"
      ;;
    '            "__NATS_WORKSPACE_INVITE_EVENT_SUBJECT__",')
      printf '            "%s",\n' "$workspace_invite_subject"
      ;;
    '            "__NATS_NPD_RECEIPT_EVENT_SUBJECT__",')
      printf '            "%s",\n' "$npd_receipt_subject"
      printf '            "%s",\n' "${npd_receipt_environment}.email.billing.notice.requested.v1"
      ;;
    '      user: "__NATS_REALTIME_CONSUMER_USER__"')
      printf '      user: "%s"\n' "$NATS_REALTIME_CONSUMER_USER"
      ;;
    '      password: "__NATS_REALTIME_CONSUMER_PASSWORD_HASH__"')
      printf '      password: "%s"\n' "$NATS_REALTIME_CONSUMER_PASSWORD_HASH"
      ;;
    '            "__NATS_IDENTITY_EVENT_DLQ_SUBJECT__"')
      printf '            "%s"\n' "$dlq_subject"
      ;;
    '      user: "__NATS_AUTH_EMAIL_CONSUMER_USER__"')
      printf '      user: "%s"\n' "$NATS_AUTH_EMAIL_CONSUMER_USER"
      ;;
    '      password: "__NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH__"')
      printf '      password: "%s"\n' "$NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH"
      ;;
    '            "__NATS_AUTH_EMAIL_DLQ_SUBJECT__"')
      printf '            "%s"\n' "$auth_email_dlq_subject"
      ;;
    '      user: "__NATS_PROVISIONER_USER__"')
      printf '      user: "%s"\n' "$NATS_PROVISIONER_USER"
      ;;
    '      password: "__NATS_PROVISIONER_PASSWORD_HASH__"')
      printf '      password: "%s"\n' "$NATS_PROVISIONER_PASSWORD_HASH"
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$template" > "$temporary_config"

if grep -q '__NATS_' "$temporary_config"; then
  fail 'template contains an unresolved runtime marker'
fi
mv "$temporary_config" "$runtime_config"
temporary_config=''
chmod 600 "$runtime_config"

unset \
  NATS_RUNTIME_USER \
  NATS_RUNTIME_PASSWORD_HASH \
  NATS_PLATFORM_PUBLISHER_USER \
  NATS_PLATFORM_PUBLISHER_PASSWORD_HASH \
  NATS_REALTIME_CONSUMER_USER \
  NATS_REALTIME_CONSUMER_PASSWORD_HASH \
  NATS_AUTH_EMAIL_CONSUMER_USER \
  NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH \
  NATS_PROVISIONER_USER \
  NATS_PROVISIONER_PASSWORD_HASH \
  NATS_IDENTITY_EVENT_SUBJECT \
  NATS_IDENTITY_EVENT_DLQ_SUBJECT \
  NATS_EMAIL_VERIFICATION_EVENT_SUBJECT \
  NATS_PASSWORD_RESET_EVENT_SUBJECT \
  NATS_WORKSPACE_INVITE_EVENT_SUBJECT \
  NATS_NPD_RECEIPT_EVENT_SUBJECT \
  NATS_AUTH_EMAIL_DLQ_SUBJECT \
  identity_subject dlq_subject email_verification_subject \
  password_reset_subject workspace_invite_subject npd_receipt_subject \
  auth_email_dlq_subject \
  identity_environment dlq_environment email_verification_environment \
  password_reset_environment workspace_invite_environment \
  npd_receipt_environment \
  auth_email_dlq_environment event_environment \
  validated_usernames validated_hashes required_names username_names hash_names \
  marker_names marker_name marker marker_count required_name username_name \
  hash_name previous_name

exec nats-server --config "$runtime_config"
