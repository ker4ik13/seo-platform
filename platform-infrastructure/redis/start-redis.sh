#!/bin/sh
set -eu

instance=${1-}
case "$instance" in
  jobs|realtime|directus) ;;
  *)
    printf '%s\n' "redis-start: instance must be jobs, realtime or directus" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
runtime_directory=/run/redis-runtime
acl_file=$runtime_directory/users.acl
runtime_config=$runtime_directory/redis.conf
temporary_config=${runtime_config}.tmp.$$

cleanup() {
  if [ -n "$temporary_config" ] && [ -e "$temporary_config" ]; then
    rm -f "$temporary_config"
  fi
}

trap cleanup 0 1 2 15
umask 077
mkdir -p "$runtime_directory"
chown redis:redis "$runtime_directory"
chmod 700 "$runtime_directory"
/bin/sh "$script_dir/render-acl.sh" "$instance" "$acl_file"
unset \
  REDIS_JOBS_API_PASSWORD \
  REDIS_JOBS_SYSTEM_PASSWORD \
  REDIS_JOBS_INSPECTION_PASSWORD \
  REDIS_JOBS_IMPORT_PASSWORD \
  REDIS_JOBS_RANK_PASSWORD \
  REDIS_JOBS_CONNECTOR_PASSWORD \
  REDIS_REALTIME_PASSWORD \
  REDIS_DIRECTUS_PASSWORD \
  REDISCLI_AUTH

cp "$script_dir/$instance.conf" "$temporary_config"
chown redis:redis "$acl_file" "$temporary_config"
chmod 600 "$acl_file" "$temporary_config"
mv "$temporary_config" "$runtime_config"
temporary_config=""

exec /usr/local/bin/docker-entrypoint.sh \
  redis-server "$runtime_config"
