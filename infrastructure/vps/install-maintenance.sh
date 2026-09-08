#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
assert_runtime_root
command -v crontab >/dev/null || runtime_fail "crontab is required"
mkdir -p "$runtime_root/logs"
chmod 700 "$runtime_root/logs"
cron_file=$(mktemp)
trap 'rm -f -- "$cron_file"' EXIT
# Preserve every unrelated crontab entry and replace only our named schedule.
(crontab -l 2>/dev/null || true) | sed '/# seo-platform-runtime-maintenance$/d' > "$cron_file"
printf "17 4 * * * SEO_PLATFORM_RUNTIME_DIR='%s' /bin/bash '%s/maintain-runtime.sh' >> '%s/logs/maintenance.log' 2>&1 # seo-platform-runtime-maintenance\n" \
  "$runtime_root" "$script_dir" "$runtime_root" >> "$cron_file"
crontab "$cron_file"
printf '%s\n' 'seo-platform-vps: daily maintenance installed at 04:17 in server timezone'
