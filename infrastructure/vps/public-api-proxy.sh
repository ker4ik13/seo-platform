#!/usr/bin/env bash

set -euo pipefail

action=${1:-apply}
caddy_admin_url=http://127.0.0.1:2019
caddy_server_name=srv_public_api
web_server_name=srv0
web_worker_route_id=seo_platform_worker_gateway_web
web_routes_url="$caddy_admin_url/config/apps/http/servers/$web_server_name/routes/0/handle/0/routes"

fail() {
  printf 'seo-platform-vps: public API proxy: %s\n' "$1" >&2
  exit 1
}

remove_proxy() {
  local status
  remove_web_worker_route
  status=$(
    curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 \
      "$caddy_admin_url/config/apps/http/servers/$caddy_server_name" || true
  )
  [ "$status" = 200 ] || return 0
  curl --fail --silent --show-error --request DELETE --max-time 5 \
    "$caddy_admin_url/config/apps/http/servers/$caddy_server_name"
}

web_worker_route() {
  local upstream=${1:-127.0.0.1:3000}
  jq --compact-output --null-input --arg id "$web_worker_route_id" --arg upstream "$upstream" '{
    "@id": $id,
    match: [{path: ["/worker/v1", "/worker/v1/*"]}],
    handle: [{handler: "reverse_proxy", upstreams: [{dial: $upstream}]}],
    terminal: true
  }'
}

remove_web_worker_route() {
  local routes index actual expected legacy
  routes=$(curl --fail --silent --max-time 3 "$web_routes_url" || true)
  [ -n "$routes" ] || return 0
  index=$(jq --raw-output --arg id "$web_worker_route_id" \
    '[to_entries[] | select(.value["@id"] == $id) | .key] | if length == 0 then "" elif length == 1 then (.[0] | tostring) else error("duplicate worker route") end' \
    <<< "$routes")
  [ -n "$index" ] || return 0
  expected=$(web_worker_route)
  legacy=$(web_worker_route 127.0.0.1:4002)
  actual=$(jq --compact-output --argjson index "$index" '.[$index]' <<< "$routes")
  if [ "$(jq --sort-keys --compact-output . <<< "$actual")" != \
    "$(jq --sort-keys --compact-output . <<< "$expected")" ] &&
    [ "$(jq --sort-keys --compact-output . <<< "$actual")" != \
    "$(jq --sort-keys --compact-output . <<< "$legacy")" ]; then
    fail "existing web worker route differs from the managed route"
  fi
  curl --fail --silent --show-error --request DELETE --max-time 5 \
    "$web_routes_url/$index"
}

apply_web_worker_route() {
  local web_authority web_host current expected legacy routes
  if [ "${WORKER_GATEWAY_ENABLED:-false}" != true ]; then
    remove_web_worker_route
    return
  fi
  case "${SEO_PLATFORM_PUBLIC_URL:-}" in
    https://*) ;;
    *) fail "public Web URL must use HTTPS" ;;
  esac
  web_authority=${SEO_PLATFORM_PUBLIC_URL#https://}
  web_authority=${web_authority%%/*}
  web_host=${web_authority%%:*}
  current=$(curl --fail --silent --show-error --max-time 3 \
    "$caddy_admin_url/config/apps/http/servers/$web_server_name") ||
    fail "public Web Caddy server is unavailable"
  if ! jq --exit-status --arg listen "$web_authority" --arg host "$web_host" '
    .listen == [$listen] and
    (.routes | length) == 1 and
    .routes[0].match == [{host: [$host]}] and
    .routes[0].handle[0].handler == "subroute" and
    (.routes[0].handle | length) == 1 and
    (.routes[0].handle[0].routes | length) >= 1 and
    (.routes[0].handle[0].routes[-1].match == null) and
    ([.routes[0].handle[0].routes[-1].handle[]? |
      select(.handler == "reverse_proxy" and
        ([.upstreams[]?.dial] | index("127.0.0.1:3000")) != null)] | length) == 1
  ' <<< "$current" >/dev/null; then
    fail "public Web Caddy route is not the expected local Web proxy"
  fi
  routes=$(jq --compact-output '.routes[0].handle[0].routes' <<< "$current")
  expected=$(web_worker_route)
  legacy=$(web_worker_route 127.0.0.1:4002)
  if jq --exit-status --argjson expected "$expected" \
    'length == 2 and .[0] == $expected' <<< "$routes" >/dev/null; then
    return
  fi
  if jq --exit-status --argjson legacy "$legacy" \
    'length == 2 and .[0] == $legacy' <<< "$routes" >/dev/null; then
    printf '%s' "$expected" |
      curl --fail --silent --show-error --request PUT \
        --header 'Content-Type: application/json' --data-binary @- --max-time 10 \
        "$web_routes_url/0"
    return
  fi
  if ! jq --exit-status 'length == 1' <<< "$routes" >/dev/null; then
    fail "public Web has unmanaged routes before the fallback"
  fi
  printf '%s' "$expected" |
    curl --fail --silent --show-error --request PUT \
      --header 'Content-Type: application/json' --data-binary @- --max-time 10 \
      "$web_routes_url/0"
}

build_proxy_config() {
  local public_authority public_host api_listen
  if [ -n "${API_PUBLIC_URL:-}" ]; then
    public_authority=${API_PUBLIC_URL#https://}
  else
    public_authority=${SEO_PLATFORM_PUBLIC_URL#https://}
    public_authority=${public_authority%%/*}
    public_host=${public_authority%%:*}
    public_authority=$public_host:4000
  fi
  public_authority=${public_authority%%/*}
  public_host=${public_authority%%:*}
  case "$public_host" in
    ''|*[!A-Za-z0-9.-]*) fail "unsupported public URL host" ;;
  esac
  case "$public_authority" in
    *:*) api_listen=$public_authority ;;
    *) api_listen=$public_host:443 ;;
  esac

  jq --compact-output --null-input \
    --arg host "$public_host" \
    --arg listen "$api_listen" \
    --argjson worker_gateway_enabled "$(if [ "${WORKER_GATEWAY_ENABLED:-false}" = true ]; then printf true; else printf false; fi)" \
    '{
      automatic_https: {disable_redirects: true},
      listen: [$listen],
      routes: ([
        if $worker_gateway_enabled then {
          match: [{host: [$host], path: ["/worker/v1", "/worker/v1/*"]}],
          handle: [{
            handler: "reverse_proxy",
            upstreams: [{dial: "127.0.0.1:4002"}]
          }],
          terminal: true
        } else empty end
      ] + [{
        match: [{host: [$host], path: ["/api/v1", "/api/v1/*"]}],
        handle: [{
          handler: "reverse_proxy",
          upstreams: [{dial: "127.0.0.1:4000"}]
        }],
        terminal: true
      }, {
        match: [{host: [$host]}],
        handle: [{handler: "static_response", status_code: 404, body: "Not found"}],
        terminal: true
      }]),
      tls_connection_policies: [{}]
    }'
}

apply_proxy() {
  local current_config expected_config
  expected_config=$(build_proxy_config)
  current_config=$(
    curl --silent --show-error --max-time 3 \
      "$caddy_admin_url/config/apps/http/servers/$caddy_server_name" || true
  )
  if [ -n "$current_config" ] &&
    [ "$(jq --sort-keys --compact-output . <<< "$current_config")" = \
      "$(jq --sort-keys --compact-output . <<< "$expected_config")" ]
  then
    apply_web_worker_route
    return 0
  fi
  printf '%s' "$expected_config" |
    curl --fail --silent --show-error --header 'Content-Type: application/json' \
      --data-binary @- --max-time 10 \
      "$caddy_admin_url/config/apps/http/servers/$caddy_server_name"
  apply_web_worker_route
}

case "$action" in
  apply) apply_proxy ;;
  remove) remove_proxy ;;
  watch)
    while :; do
      apply_proxy
      sleep 30
    done
    ;;
  *) fail "expected apply, remove, or watch" ;;
esac
