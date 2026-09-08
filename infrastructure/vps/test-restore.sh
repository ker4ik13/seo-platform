#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
. "$script_dir/runtime-lib.sh"
assert_runtime_root
[ "${SEO_PLATFORM_RESTORE_CONFIRM:-}" = RESTORE_TO_ISOLATED_CLUSTER ] || runtime_fail "set SEO_PLATFORM_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_CLUSTER"
backup_dir=$(realpath -e -- "${SEO_PLATFORM_RESTORE_BACKUP_DIR:?backup directory is required}")
case "$backup_dir" in "$runtime_root"/backups/*) ;; *) runtime_fail "use a backup under the managed runtime backup directory" ;; esac
for name in platform seo jobs realtime; do [ -f "$backup_dir/$name.dump" ] || runtime_fail "missing service backup"; done
(cd "$backup_dir" && sha256sum --check SHA256SUMS > /dev/null)
pg_bin=$(postgres_bin_dir)
export LD_LIBRARY_PATH=$(postgres_library_dir)
export PATH="$pg_bin:$PATH"
test_root=$(mktemp -d "$runtime_root/tmp/e2e.restore.XXXXXXXX")
printf '%s\n' "$$" > "$test_root/owner.pid"
mkdir -p "$test_root/socket"
openssl rand -hex 24 > "$test_root/password"
export PGPASSWORD=$(cat "$test_root/password")
test_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
[[ "$test_port" =~ ^[0-9]+$ ]] && [ "$test_port" != 5432 ] || runtime_fail "invalid restore test port"
cleanup() {
  if [ -f "$test_root/data/postmaster.pid" ]; then "$pg_bin/pg_ctl" -D "$test_root/data" -m immediate --wait stop > /dev/null 2>&1 || return; fi
  rm -f -- "$test_root/password"
  # Remove only the isolated restored copy. Original backups remain untouched.
  case "$test_root" in "$runtime_root"/tmp/e2e.restore.*) rm -rf -- "$test_root/data" ;; esac
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$test_root/data" --username=postgres --pwfile="$test_root/password" --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --no-locale > "$test_root/init.log"
"$pg_bin/pg_ctl" -D "$test_root/data" -l "$test_root/server.log" -o "-h 127.0.0.1 -p $test_port -k $test_root/socket -c log_min_error_statement=panic -c log_error_verbosity=terse -c log_parameter_max_length_on_error=0" --wait start > /dev/null
export PGHOST=127.0.0.1 PGPORT="$test_port" PGUSER=postgres
cat > "$test_root/counts.sql" <<'SQL'
CREATE TEMP TABLE restore_counts (name text, rows bigint);
DO $$ DECLARE relation record; total bigint; BEGIN
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', relation.tablename) INTO total;
    INSERT INTO restore_counts VALUES(relation.tablename, total);
  END LOOP;
END $$;
SELECT name || ':' || rows FROM restore_counts ORDER BY name;
SQL
printf 'restore artifacts=%s backup=%s\n' "$test_root" "$backup_dir"
for entry in 'platform:backend-core-api' 'seo:backend-core-seo' 'jobs:backend-execution' 'realtime:backend-core-realtime'; do
  IFS=: read -r database package <<< "$entry"
  export PGDATABASE="restore_$database"
  "$pg_bin/createdb" "$PGDATABASE"
  "$pg_bin/pg_restore" --exit-on-error --no-owner --no-privileges --dbname "$PGDATABASE" "$backup_dir/$database.dump" > "$test_root/$database-restore.log" 2>&1
  "$pg_bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -f "$test_root/counts.sql" > "$test_root/$database-before.txt"
  DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:$test_port/$PGDATABASE" pnpm --dir "$project_root" --filter "@seo-platform/$package" prisma:migrate:deploy > "$test_root/$database-upgrade.log" 2>&1
  "$pg_bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -f "$test_root/counts.sql" > "$test_root/$database-after.txt"
  python3 - "$test_root/$database-before.txt" "$test_root/$database-after.txt" <<'PY'
import sys
def counts(file):
    return dict(line.strip().rsplit(':',1) for line in open(file) if line.strip())
before,after=counts(sys.argv[1]),counts(sys.argv[2])
assert all(after.get(name)==count for name,count in before.items()), 'Restored table counts changed during upgrade'
PY
  printf 'restore database=%s result=passed rows_preserved=true\n' "$database"
done
printf 'restore result=passed databases=4 original_backups=preserved\n'
