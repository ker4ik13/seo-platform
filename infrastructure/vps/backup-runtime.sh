#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
load_runtime_environment
wait_for_postgres
pg_bin=$(postgres_bin_dir)
mkdir -p "$runtime_root/backups"
chmod 700 "$runtime_root/backups"
backup_dir=$(mktemp -d "$runtime_root/backups/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
for entry in 'platform:PLATFORM' 'seo:SEO' 'jobs:JOBS' 'realtime:REALTIME'; do
  IFS=: read -r database prefix <<< "$entry"
  password_key="${prefix}_DATABASE_OWNER_PASSWORD"
  env -i PATH="$pg_bin:/usr/bin:/bin" LD_LIBRARY_PATH="$(postgres_library_dir)" \
    PGPASSWORD="${!password_key}" "$pg_bin/pg_dump" \
    --host=127.0.0.1 --port=5432 --username="${database}_owner" --dbname="${database}_db" \
    --format=custom --file="$backup_dir/$database.dump"
done
(
  cd "$backup_dir"
  sha256sum ./*.dump > SHA256SUMS
)
printf 'backup result=completed directory=%s databases=4\n' "$backup_dir"
# This is a per-database consistent local backup. Production recovery also
# needs object storage, the secret keyring and event/queue recovery procedures.
