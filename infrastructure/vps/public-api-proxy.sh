#!/usr/bin/env bash

set -euo pipefail

action=${1:-apply}
caddy_admin_url=http://127.0.0.1:2019
caddy_server_name=srv_public_api

fail() {
  printf 'seo-platform-vps: public API proxy: %s\n' "$1" >&2
  exit 1
}

remove_proxy() {
  local status
  status=$(
    curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 \
      "$caddy_admin_url/config/apps/http/servers/$caddy_server_name" || true
  )
  [ "$status" = 200 ] || return 0
  curl --fail --silent --show-error --request DELETE --max-time 5 \
    "$caddy_admin_url/config/apps/http/servers/$caddy_server_name"
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
    '{
      automatic_https: {disable_redirects: true},
      listen: [$listen],
      routes: [{
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
      }],
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
    return 0
  fi
  printf '%s' "$expected_config" |
    curl --fail --silent --show-error --header 'Content-Type: application/json' \
      --data-binary @- --max-time 10 \
      "$caddy_admin_url/config/apps/http/servers/$caddy_server_name"
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
