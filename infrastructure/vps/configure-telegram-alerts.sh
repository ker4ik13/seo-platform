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
  runtime_fail "stop $runtime_session before changing Telegram alert credentials"

bot_token=${TELEGRAM_ALERT_BOT_TOKEN:-}
chat_id=${SEO_PLATFORM_TELEGRAM_ALERT_CHAT_ID:-${TELEGRAM_ALERT_CHAT_ID:-}}
thread_id=${SEO_PLATFORM_TELEGRAM_ALERT_THREAD_ID:-${TELEGRAM_ALERT_THREAD_ID:-}}
alert_environment=${SEO_PLATFORM_TELEGRAM_ALERT_ENVIRONMENT:-${TELEGRAM_ALERT_ENVIRONMENT:-production}}

if [ -t 0 ]; then
  printf 'Telegram bot token (leave empty to keep the current value): ' >&2
  IFS= read -r -s entered_token
  printf '\n' >&2
  if [ -n "$entered_token" ]; then
    bot_token=$entered_token
  fi
  if [ -z "$chat_id" ]; then
    printf 'Telegram numeric chat ID: ' >&2
    IFS= read -r chat_id
  fi
fi

[[ "$bot_token" =~ ^[0-9]{6,15}:[A-Za-z0-9_-]{30,80}$ ]] ||
  runtime_fail "Telegram bot token is invalid"
[[ "$chat_id" =~ ^-?[0-9]{1,20}$ ]] ||
  runtime_fail "SEO_PLATFORM_TELEGRAM_ALERT_CHAT_ID must be numeric"
if [ -n "$thread_id" ]; then
  [[ "$thread_id" =~ ^[0-9]{1,10}$ ]] ||
    runtime_fail "SEO_PLATFORM_TELEGRAM_ALERT_THREAD_ID must be a positive integer"
  [ "$thread_id" -ge 1 ] && [ "$thread_id" -le 2147483647 ] ||
    runtime_fail "SEO_PLATFORM_TELEGRAM_ALERT_THREAD_ID is out of range"
fi
[[ "$alert_environment" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] ||
  runtime_fail "SEO_PLATFORM_TELEGRAM_ALERT_ENVIRONMENT is invalid"

node_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/node
[ -x "$node_bin" ] || runtime_fail "Node.js runtime is missing"

if ! env \
  -i \
  PATH="/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin" \
  TELEGRAM_ALERT_BOT_TOKEN="$bot_token" \
  TELEGRAM_ALERT_CHAT_ID="$chat_id" \
  TELEGRAM_ALERT_THREAD_ID="$thread_id" \
  "$node_bin" \
  --input-type=module \
  -e '
    const body = {
      chat_id: process.env.TELEGRAM_ALERT_CHAT_ID,
      text: "SEO Platform: проверка канала внутренних ошибок",
      disable_web_page_preview: true
    };
    if (process.env.TELEGRAM_ALERT_THREAD_ID) {
      body.message_thread_id = Number(process.env.TELEGRAM_ALERT_THREAD_ID);
    }
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_ALERT_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(5_000)
      }
    );
    await response.body?.cancel();
    if (!response.ok) process.exit(1);
  '
then
  runtime_fail "Telegram canary failed; alert configuration was not changed"
fi

temporary_env_file=$runtime_root/runtime.env.tmp.$$
trap 'rm -f "$temporary_env_file"' EXIT INT TERM

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    TELEGRAM_ALERTS_ENABLED=*|TELEGRAM_ALERT_BOT_TOKEN=*|TELEGRAM_ALERT_CHAT_ID=*|TELEGRAM_ALERT_THREAD_ID=*|TELEGRAM_ALERT_ENVIRONMENT=*) ;;
    *) printf '%s\n' "$line" >> "$temporary_env_file" ;;
  esac
done < "$runtime_env_file"

write_value() {
  local name=$1
  local value=$2
  case "$value" in
    *"'"*|*$'\n'*|*$'\r'*) runtime_fail "unsafe Telegram environment value" ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$temporary_env_file"
}

write_value TELEGRAM_ALERTS_ENABLED true
write_value TELEGRAM_ALERT_BOT_TOKEN "$bot_token"
write_value TELEGRAM_ALERT_CHAT_ID "$chat_id"
write_value TELEGRAM_ALERT_THREAD_ID "$thread_id"
write_value TELEGRAM_ALERT_ENVIRONMENT "$alert_environment"

chmod 600 "$temporary_env_file"
mv "$temporary_env_file" "$runtime_env_file"
temporary_env_file=
trap - EXIT INT TERM

printf '%s\n' \
  "seo-platform-vps: Telegram operational alerts are configured" \
  "seo-platform-vps: bot token remains only in runtime.env (mode 600)"
