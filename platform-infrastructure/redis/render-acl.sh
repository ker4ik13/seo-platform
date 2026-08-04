#!/bin/sh
set -eu

umask 077

fail() {
  printf '%s\n' "redis-acl-renderer: $1" >&2
  exit 1
}

instance=${1-}
destination=${2-}

case "$instance" in
  jobs|realtime|directus) ;;
  *) fail "instance must be jobs, realtime or directus" ;;
esac

case "$destination" in
  /*) ;;
  *) fail "destination must be an absolute path" ;;
esac

temporary="${destination}.tmp.$$"
rendered_hashes=""

cleanup() {
  if [ -n "$temporary" ] && [ -e "$temporary" ]; then
    rm -f "$temporary"
  fi
}

trap cleanup 0 1 2 15
: > "$temporary"
chmod 600 "$temporary"

read_secret() {
  secret_name=$1
  if ! printenv "$secret_name" >/dev/null 2>&1; then
    fail "$secret_name is required"
  fi

  secret_value="$(printenv "$secret_name"; printf 'x')"
  secret_value=${secret_value%x}
  secret_value=${secret_value%?}
  secret_length=${#secret_value}
  if [ "$secret_length" -lt 32 ] || [ "$secret_length" -gt 512 ]; then
    fail "$secret_name must contain 32..512 characters"
  fi
  case "$secret_value" in
    *[!A-Za-z0-9._~-]*) fail "$secret_name must be URL-safe" ;;
  esac

  lowercase_value="$(printf '%s' "$secret_value" | tr '[:upper:]' '[:lower:]')"
  case "$lowercase_value" in
    replace-*|change-*|changeme*|example*|dummy-*|placeholder*|test-*|your-*|your_*)
      fail "$secret_name must not use an example placeholder"
      ;;
  esac

  digest_output="$(printf '%s' "$secret_value" | sha256sum)"
  secret_hash=${digest_output%% *}
  case "$secret_hash" in
    *[!0-9a-f]*|'') fail "$secret_name could not be hashed safely" ;;
  esac
  if [ "${#secret_hash}" -ne 64 ]; then
    fail "$secret_name could not be hashed safely"
  fi
  case " $rendered_hashes " in
    *" $secret_hash "*) fail "$secret_name must be unique within the Redis instance" ;;
  esac
  rendered_hashes="$rendered_hashes $secret_hash"
  unset digest_output lowercase_value secret_length secret_value
}

append_user() {
  redis_username=$1
  redis_secret_name=$2
  redis_scope=$3
  redis_commands=$4
  read_secret "$redis_secret_name"
  printf 'user %s reset on #%s %s %s\n' \
    "$redis_username" "$secret_hash" "$redis_scope" "$redis_commands" \
    >> "$temporary"
  unset redis_commands redis_scope redis_secret_name redis_username secret_hash
}

printf '%s\n' \
  'user default reset off resetkeys resetchannels -@all' \
  'user seo_health reset on nopass resetkeys resetchannels -@all +ping' \
  > "$temporary"

case "$instance" in
  jobs)
    jobs_commands='-@all +ping +quit +info +client|setname +client|setinfo +eval +evalsha +script|load +bzpopmin +del +exists +get +hdel +hexists +hget +hgetall +hincrby +hlen +hmget +hmset +hset +incr +lindex +llen +lpop +lpos +lpush +lrange +lrem +lset +ltrim +persist +pexpire +pttl +rename +rpop +rpoplpush +rpush +sadd +scard +set +sismember +smembers +srem +type +xadd +xtrim +zadd +zcard +zcount +zpopmin +zrange +zrangebyscore +zrem +zremrangebyrank +zremrangebyscore +zrevrange +zrevrangebyscore +zscore'
    append_user seo_jobs_api REDIS_JOBS_API_PASSWORD \
      '~seo-platform:jobs:v1:system:* ~seo-platform:jobs:v1:upload-inspection:* ~seo-platform:jobs:v1:semantic-import:* ~seo-platform:jobs:v1:integration-credential-validation:* ~seo-platform:jobs:v1:rank-preparation:* ~seo-platform:jobs:v1:rank-automation:* ~seo-platform:jobs:v1:crawls:* ~seo-platform:jobs:v1:crawl-automation:* resetchannels' \
      "$jobs_commands"
    append_user seo_jobs_system REDIS_JOBS_SYSTEM_PASSWORD \
      '~seo-platform:jobs:v1:system:* resetchannels' "$jobs_commands"
    append_user seo_jobs_inspection REDIS_JOBS_INSPECTION_PASSWORD \
      '~seo-platform:jobs:v1:upload-inspection:* resetchannels' "$jobs_commands"
    append_user seo_jobs_import REDIS_JOBS_IMPORT_PASSWORD \
      '~seo-platform:jobs:v1:semantic-import:* resetchannels' "$jobs_commands"
    append_user seo_jobs_rank REDIS_JOBS_RANK_PASSWORD \
      '~seo-platform:jobs:v1:rank-preparation:* resetchannels' "$jobs_commands"
    append_user seo_jobs_crawl REDIS_JOBS_CRAWL_PASSWORD \
      '~seo-platform:jobs:v1:crawls:* resetchannels' "$jobs_commands"
    append_user seo_jobs_connector REDIS_JOBS_CONNECTOR_PASSWORD \
      '~seo-platform:jobs:v1:integration-credential-validation:* resetchannels' \
      "$jobs_commands +time"
    unset jobs_commands
    ;;
  realtime)
    realtime_commands='-@all +hello +client|setinfo +ping +quit +publish +subscribe +psubscribe +unsubscribe +punsubscribe +pubsub|numsub'
    append_user seo_realtime REDIS_REALTIME_PASSWORD \
      'resetkeys resetchannels &seo-platform:realtime:v1#/collaboration#* &seo-platform:realtime:v1-request#/collaboration# &seo-platform:realtime:v1-response#/collaboration#*' \
      "$realtime_commands"
    unset realtime_commands
    ;;
  directus)
    append_user seo_directus REDIS_DIRECTUS_PASSWORD \
      '~* &*' '+@all -@admin -@dangerous'
    ;;
esac

chmod 600 "$temporary"
mv "$temporary" "$destination"
temporary=""
unset rendered_hashes
