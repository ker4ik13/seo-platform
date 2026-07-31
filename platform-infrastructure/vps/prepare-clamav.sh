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

clam_root=$runtime_root/clamav
clam_bin=$clam_root/usr/local/bin
clam_sbin=$clam_root/usr/local/sbin
clam_lib=$clam_root/usr/local/lib
clam_certs=$clam_root/usr/local/etc/certs
clam_database=$clam_root/database
clam_run=$clam_root/run
clamd_config=$clam_run/clamd.conf
freshclam_config=$clam_run/freshclam.conf

for executable in \
  "$clam_sbin/clamd" \
  "$clam_bin/clamdscan" \
  "$clam_bin/freshclam"
do
  [ -x "$executable" ] ||
    runtime_fail "ClamAV 1.5.3 is not installed"
done

mkdir -p "$clam_database" "$clam_run"
chmod 700 "$clam_root" "$clam_database" "$clam_run"

sed \
  -e "s#__CLAMAV_DATABASE_DIR__#$clam_database#g" \
  -e "s#__CLAMAV_PID_FILE__#$clam_run/clamd.pid#g" \
  "$script_dir/clamd.conf" \
  > "$clamd_config"
sed \
  -e "s#__CLAMAV_DATABASE_DIR__#$clam_database#g" \
  -e "s#__FRESHCLAM_PID_FILE__#$clam_run/freshclam.pid#g" \
  "$script_dir/freshclam.conf" \
  > "$freshclam_config"
chmod 600 "$clamd_config" "$freshclam_config"

if ! env \
  -i \
  PATH="$clam_bin:/usr/bin:/bin" \
  LD_LIBRARY_PATH="$clam_lib" \
  CVD_CERTS_DIR="$clam_certs" \
  CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  "$clam_bin/freshclam" \
  --config-file "$freshclam_config" \
  --stdout
then
  find "$clam_database" -maxdepth 1 -type f \
    \( -name '*.cvd' -o -name '*.cld' \) \
    -print -quit |
    grep -q . ||
    runtime_fail "ClamAV signatures are unavailable"
  printf '%s\n' \
    "seo-platform-vps: ClamAV update failed; using the existing signed database" >&2
fi

printf '%s\n' "seo-platform-vps: ClamAV signatures are ready"
