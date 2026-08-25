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
  runtime_fail "stop $runtime_session before changing auth-email credentials"

sender=${SEO_PLATFORM_AUTH_EMAIL_FROM:-${AUTH_EMAIL_FROM:-}}
smtp_host=${SEO_PLATFORM_AUTH_EMAIL_SMTP_HOST:-${AUTH_EMAIL_SMTP_HOST:-}}
smtp_user=${SEO_PLATFORM_AUTH_EMAIL_SMTP_USER:-${AUTH_EMAIL_SMTP_USER:-}}
smtp_password=${SEO_PLATFORM_AUTH_EMAIL_SMTP_PASSWORD:-${AUTH_EMAIL_SMTP_PASSWORD:-}}
smtp_port=${SEO_PLATFORM_AUTH_EMAIL_SMTP_PORT:-${AUTH_EMAIL_SMTP_PORT:-587}}
smtp_secure=${SEO_PLATFORM_AUTH_EMAIL_SMTP_SECURE:-${AUTH_EMAIL_SMTP_SECURE:-}}

if [ -t 0 ]; then
  if [ -z "$sender" ]; then
    printf 'Auth-email sender mailbox: ' >&2
    IFS= read -r sender
  fi
  if [ -z "$smtp_host" ]; then
    printf 'SMTP host: ' >&2
    IFS= read -r smtp_host
  fi
  if [ -z "$smtp_user" ]; then
    printf 'SMTP username: ' >&2
    IFS= read -r smtp_user
  fi
  printf 'SMTP password (leave empty to keep the current value): ' >&2
  IFS= read -r -s entered_password
  printf '\n' >&2
  if [ -n "$entered_password" ]; then
    smtp_password=$entered_password
  fi
fi

case "$sender" in
  *@*.*) ;;
  *) runtime_fail "SEO_PLATFORM_AUTH_EMAIL_FROM must be one mailbox address" ;;
esac
case "${sender%@*}" in
  *"@"*) runtime_fail "SEO_PLATFORM_AUTH_EMAIL_FROM must be one mailbox address" ;;
esac
case "$sender" in
  *"'"*|*$'\n'*|*$'\r'*) runtime_fail "auth-email sender contains unsupported characters" ;;
esac
case "$smtp_host" in
  ''|*[!A-Za-z0-9.-]*|.*|*..*|*.) runtime_fail "SEO_PLATFORM_AUTH_EMAIL_SMTP_HOST must be a hostname" ;;
esac
case "$smtp_port" in
  ''|*[!0-9]*) runtime_fail "SEO_PLATFORM_AUTH_EMAIL_SMTP_PORT must be a valid port" ;;
esac
[ "$smtp_port" -ge 1 ] && [ "$smtp_port" -le 65535 ] ||
  runtime_fail "SEO_PLATFORM_AUTH_EMAIL_SMTP_PORT must be a valid port"
[ -n "$smtp_user" ] || runtime_fail "SEO_PLATFORM_AUTH_EMAIL_SMTP_USER is required"
[ -n "$smtp_password" ] || runtime_fail "SMTP password is required on stdin"
case "$smtp_user$smtp_password" in
  *"'"*|*$'\n'*|*$'\r'*) runtime_fail "SMTP credentials contain unsupported characters" ;;
esac

if [ -z "$smtp_secure" ]; then
  if [ "$smtp_port" = 465 ]; then
    smtp_secure=true
  else
    smtp_secure=false
  fi
fi
case "$smtp_secure" in
  true|false) ;;
  *) runtime_fail "SEO_PLATFORM_AUTH_EMAIL_SMTP_SECURE must be true or false" ;;
esac

sender_domain=$(printf '%s' "${sender##*@}" | tr '[:upper:]' '[:lower:]')
message_id_domain=${SEO_PLATFORM_AUTH_EMAIL_MESSAGE_ID_DOMAIN:-${AUTH_EMAIL_MESSAGE_ID_DOMAIN:-$sender_domain}}
message_id_domain=$(printf '%s' "$message_id_domain" | tr '[:upper:]' '[:lower:]')
case "$message_id_domain" in
  ''|*[!a-z0-9.-]*|.*|*..*|*.) runtime_fail "auth-email Message-ID domain is invalid" ;;
esac

node_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/node
[ -x "$node_bin" ] || runtime_fail "Node.js runtime is missing"

if ! printf '%s\0' \
  "$sender" \
  "$message_id_domain" \
  "$smtp_host" \
  "$smtp_port" \
  "$smtp_secure" \
  "$smtp_user" \
  "$smtp_password" |
  (
    cd "$project_root/backend-execution"
    env \
      -i \
      PATH="/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin" \
      "$node_bin" \
      --input-type=module \
      -e '
        import { isIP } from "node:net";
        import { readFile } from "node:fs/promises";
        import nodemailer from "nodemailer";

        const values = (await readFile(0)).toString("utf8").split("\0");
        const [sender, messageIdDomain, host, portText, secureText, user, password] = values;
        const separator = sender?.lastIndexOf("@") ?? -1;
        const local = sender?.slice(0, separator) ?? "";
        const domain = sender?.slice(separator + 1).toLowerCase() ?? "";
        const atom = "[A-Za-z0-9!#$%&*+/=?^_`{|}~-]+";
        const mailboxValid =
          sender !== undefined &&
          sender.length <= 254 &&
          separator > 0 &&
          local.length <= 64 &&
          new RegExp(`^${atom}(?:\\.${atom})*$`, "u").test(local) &&
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(domain);
        const domainValid =
          messageIdDomain !== undefined &&
          messageIdDomain.length <= 205 &&
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(messageIdDomain);
        const hostValid =
          host !== undefined &&
          (isIP(host) !== 0 ||
            /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu.test(host));
        const port = Number(portText);
        const secure = secureText === "true";
        const credentialsValid =
          user !== undefined &&
          user.length > 0 &&
          user.length <= 320 &&
          [...user].every((character) => {
            const code = character.codePointAt(0);
            return code !== undefined && code >= 0x21 && code <= 0x7e;
          }) &&
          password !== undefined &&
          password.length > 0 &&
          password.length <= 1_024;
        if (
          !mailboxValid ||
          !domainValid ||
          !hostValid ||
          !Number.isSafeInteger(port) ||
          port < 1 ||
          port > 65_535 ||
          !["true", "false"].includes(secureText ?? "") ||
          !credentialsValid
        ) {
          process.exit(1);
        }

        const transport = nodemailer.createTransport({
          host,
          port,
          secure,
          requireTLS: !secure,
          tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
          connectionTimeout: 5_000,
          greetingTimeout: 5_000,
          socketTimeout: 10_000,
          auth: { user, pass: password }
        });
        try {
          await transport.verify();
        } catch {
          process.exitCode = 1;
        } finally {
          transport.close();
        }
      '
  ); then
  runtime_fail "SMTP verification failed; auth-email configuration was not changed"
fi

temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    AUTH_EMAIL_ENABLED=*|AUTH_EMAIL_FROM=*|AUTH_EMAIL_MESSAGE_ID_DOMAIN=*|AUTH_EMAIL_SMTP_HOST=*|AUTH_EMAIL_SMTP_PORT=*|AUTH_EMAIL_SMTP_SECURE=*|AUTH_EMAIL_SMTP_USER=*|AUTH_EMAIL_SMTP_PASSWORD=*|AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS=*|AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS=*|AUTH_EMAIL_MAX_ATTEMPTS=*|AUTH_EMAIL_LEASE_SECONDS=*|AUTH_EMAIL_DISPATCH_MS=*|AUTH_EMAIL_FETCH_EXPIRES_MS=*|AUTH_EMAIL_PUBLISH_TIMEOUT_MS=*|AUTH_EMAIL_RETRY_BASE_MS=*|AUTH_EMAIL_RETRY_MAX_MS=*|AUTH_EMAIL_MAX_PAYLOAD_BYTES=*|AUTH_EMAIL_SHUTDOWN_GRACE_MS=*) ;;
    *) printf '%s\n' "$line" >> "$temporary_env_file" ;;
  esac
done < "$runtime_env_file"

write_value() {
  local name=$1
  local value=$2
  printf "%s='%s'\n" "$name" "$value" >> "$temporary_env_file"
}

write_value AUTH_EMAIL_ENABLED true
write_value AUTH_EMAIL_FROM "$sender"
write_value AUTH_EMAIL_MESSAGE_ID_DOMAIN "$message_id_domain"
write_value AUTH_EMAIL_SMTP_HOST "$smtp_host"
write_value AUTH_EMAIL_SMTP_PORT "$smtp_port"
write_value AUTH_EMAIL_SMTP_SECURE "$smtp_secure"
write_value AUTH_EMAIL_SMTP_USER "$smtp_user"
write_value AUTH_EMAIL_SMTP_PASSWORD "$smtp_password"
write_value AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS 5000
write_value AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS 10000
write_value AUTH_EMAIL_MAX_ATTEMPTS 10
write_value AUTH_EMAIL_LEASE_SECONDS 120
write_value AUTH_EMAIL_DISPATCH_MS 1000
write_value AUTH_EMAIL_FETCH_EXPIRES_MS 30000
write_value AUTH_EMAIL_PUBLISH_TIMEOUT_MS 5000
write_value AUTH_EMAIL_RETRY_BASE_MS 1000
write_value AUTH_EMAIL_RETRY_MAX_MS 300000
write_value AUTH_EMAIL_MAX_PAYLOAD_BYTES 65536
write_value AUTH_EMAIL_SHUTDOWN_GRACE_MS 10000

chmod 600 "$temporary_env_file"
mv "$temporary_env_file" "$runtime_env_file"
temporary_env_file=
trap - EXIT INT TERM

printf '%s\n' \
  "seo-platform-vps: transactional auth-email is configured" \
  "seo-platform-vps: SMTP credentials remain only in runtime.env (mode 600)"
