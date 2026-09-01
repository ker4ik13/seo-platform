#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

[ "${SEO_PLATFORM_API_SMOKE_CONFIRM:-}" = "CREATE_TEST_DATA" ] ||
  runtime_fail "set SEO_PLATFORM_API_SMOKE_CONFIRM=CREATE_TEST_DATA to run the mutating API smoke"

load_runtime_environment

api_base="$(public_api_endpoint)/api/v1"
test_root=$(mktemp -d)
case "$test_root" in
  /tmp/tmp.*) ;;
  *) runtime_fail "mktemp returned an unexpected path" ;;
esac
trap 'rm -rf -- "$test_root"' EXIT INT TERM

cookie_jar=$test_root/cookies
response_body=$test_root/response.json
csrf_token=
response_status=
api_token=
smoke_email="public-api-smoke-$(date -u +%Y%m%d%H%M%S)-$$@example.invalid"
smoke_password="E2e$(openssl rand -hex 14)!Aa9"

fail_test() {
  local operation=$1
  local expected=$2
  printf 'public-api-smoke operation=%s expected=%s actual=%s\n' \
    "$operation" "$expected" "$response_status" >&2
  jq -c '{code: .error.code, message: .error.message}' \
    "$response_body" >&2 2>/dev/null || true
  exit 1
}

expect_status() {
  local expected=$1
  local operation=$2
  [ "$response_status" = "$expected" ] ||
    fail_test "$operation" "$expected"
  printf 'public-api-smoke operation=%s status=%s\n' \
    "$operation" "$response_status"
}

session_call() {
  local method=$1
  local path=$2
  local payload=${3:-}
  local entity_version=${4:-}
  local idempotency_key=${5:-}
  local request_arguments=(
    --insecure
    --silent
    --show-error
    --max-time 30
    --request "$method"
    --header "Accept: application/json"
    --header "Origin: $SEO_PLATFORM_PUBLIC_URL"
    --cookie "$cookie_jar"
    --cookie-jar "$cookie_jar"
    --output "$response_body"
    --write-out '%{http_code}'
  )
  if [ "$method" != GET ] && [ -n "$csrf_token" ]; then
    request_arguments+=(--header "X-CSRF-Token: $csrf_token")
  fi
  if [ -n "$entity_version" ]; then
    request_arguments+=(--header "If-Match: \"v$entity_version\"")
  fi
  if [ -n "$idempotency_key" ]; then
    request_arguments+=(--header "Idempotency-Key: $idempotency_key")
  fi
  if [ -n "$payload" ]; then
    request_arguments+=(
      --header "Content-Type: application/json"
      --data-binary @-
    )
    response_status=$(
      printf '%s' "$payload" |
        curl "${request_arguments[@]}" \
          "$SEO_PLATFORM_PUBLIC_URL/app/api/$path"
    )
  else
    response_status=$(
      curl "${request_arguments[@]}" \
        "$SEO_PLATFORM_PUBLIC_URL/app/api/$path"
    )
  fi
}

token_call() {
  local method=$1
  local path=$2
  local payload=${3:-}
  local idempotency_key=${4:-}
  local bearer=${5:-$api_token}
  local request_arguments=(
    --insecure
    --silent
    --show-error
    --max-time 30
    --request "$method"
    --header "Accept: application/json"
    --header "Authorization: Bearer $bearer"
    --output "$response_body"
    --write-out '%{http_code}'
  )
  if [ -n "$idempotency_key" ]; then
    request_arguments+=(--header "Idempotency-Key: $idempotency_key")
  fi
  if [ -n "$payload" ]; then
    request_arguments+=(
      --header "Content-Type: application/json"
      --data-binary @-
    )
    response_status=$(
      printf '%s' "$payload" |
        curl "${request_arguments[@]}" "$api_base/$path"
    )
  else
    response_status=$(
      curl "${request_arguments[@]}" "$api_base/$path"
    )
  fi
}

registration_body=$(
  jq -cn \
    --arg email "$smoke_email" \
    --arg password "$smoke_password" \
    '{
      email: $email,
      password: $password,
      displayName: "Public API smoke",
      country: "DE",
      locale: "ru",
      timezone: "Europe/Berlin",
      termsVersion: "2026-07-01",
      privacyVersion: "2026-07-01",
      termsAccepted: true,
      privacyAccepted: true,
      marketingAccepted: false,
      marketingVersion: "2026-07-01"
    }'
)
session_call POST auth/register "$registration_body"
expect_status 201 register
csrf_token=$(
  awk '$6 == "seo_csrf" {print $7}' "$cookie_jar" |
    tail -1
)
[ -n "$csrf_token" ] ||
  runtime_fail "registration did not issue a CSRF cookie"

session_call POST workspaces \
  '{"name":"Public API smoke","country":"DE","locale":"ru","timezone":"Europe/Berlin","billingCurrency":"RUB"}'
expect_status 201 workspace-create
workspace_id=$(jq -er '.data.id' "$response_body")

session_call POST "workspaces/$workspace_id/billing/trial" \
  '' \
  '' \
  "public-api-trial-$(openssl rand -hex 12)"
expect_status 201 trial-start

session_call POST "workspaces/$workspace_id/projects" \
  '{"name":"API Alpha","domain":"api-alpha.example.invalid","locale":"ru","timezone":"Europe/Berlin"}'
expect_status 201 project-alpha-create
project_alpha=$(jq -er '.data.id' "$response_body")

session_call POST "workspaces/$workspace_id/projects" \
  '{"name":"API Beta","domain":"api-beta.example.invalid","locale":"ru","timezone":"Europe/Berlin"}'
expect_status 201 project-beta-create
project_beta=$(jq -er '.data.id' "$response_body")

session_call POST "projects/$project_alpha/keywords" \
  '{"text":"api security alpha","language":"en","priority":50,"isFavorite":false,"isTracked":true,"tagNames":["e2e"]}'
expect_status 201 keyword-alpha-create
keyword_alpha=$(jq -er '.data.id' "$response_body")

session_call POST "projects/$project_beta/keywords" \
  '{"text":"api security beta","language":"en","priority":50,"isFavorite":false,"isTracked":true,"tagNames":["e2e"]}'
expect_status 201 keyword-beta-create

session_call GET "workspaces/$workspace_id/api-tokens"
expect_status 200 api-token-empty-list
jq -e '.data.tokens == []' "$response_body" >/dev/null ||
  runtime_fail "new API token collection is not empty"

restricted_token_input=$(
  jq -cn \
    --arg projectId "$project_alpha" \
    '{
      name: "Restricted read agent",
      scopes: ["projects:read", "semantics:read"],
      allProjects: false,
      projectIds: [$projectId],
      expiresAt: null
    }'
)
session_call POST \
  "workspaces/$workspace_id/api-tokens" \
  "$restricted_token_input"
expect_status 201 api-token-create
api_token=$(jq -er '.data.token' "$response_body")
token_id=$(jq -er '.data.id' "$response_body")
token_version=$(jq -er '.data.version' "$response_body")
case "$api_token" in
  seo_pat_*) ;;
  *) runtime_fail "created API token has an invalid prefix" ;;
esac

session_call GET "workspaces/$workspace_id/api-tokens"
expect_status 200 api-token-list-without-secret
jq -e \
  --arg id "$token_id" \
  '.data.tokens | length == 1 and .[0].id == $id and (.[0] | has("token") | not)' \
  "$response_body" >/dev/null ||
  runtime_fail "API token list leaks or omits token metadata"

token_call GET access
expect_status 200 restricted-access-discovery
jq -e \
  --arg tokenId "$token_id" \
  --arg workspaceId "$workspace_id" \
  --arg projectId "$project_alpha" \
  --arg secret "$api_token" \
  '.data.apiVersion == "v1" and
   .data.token.id == $tokenId and
   .data.token.name == "Restricted read agent" and
   .data.token.allProjects == false and
   .data.workspace.id == $workspaceId and
   .data.workspace.name == "Public API smoke" and
   (.data.projects | length == 1 and .[0].id == $projectId and .[0].name == "API Alpha") and
   ((tostring | contains($secret)) | not)' \
  "$response_body" >/dev/null ||
  runtime_fail "restricted access discovery leaks or omits token context"

session_call GET access
expect_status 403 access-discovery-cookie-denied

token_call GET "workspaces/$workspace_id/projects"
expect_status 200 restricted-project-list
jq -e \
  --arg id "$project_alpha" \
  '.data | length == 1 and .[0].id == $id' \
  "$response_body" >/dev/null ||
  runtime_fail "restricted token project list is not filtered"

token_call GET "projects/$project_alpha/keywords?limit=20"
expect_status 200 semantics-read-allowed
jq -e \
  --arg id "$keyword_alpha" \
  '.data | any(.id == $id)' \
  "$response_body" >/dev/null ||
  runtime_fail "allowed semantic keyword is missing"

token_call GET "projects/$project_beta/keywords?limit=20"
expect_status 404 cross-project-hidden

token_call POST "projects/$project_alpha/keywords" \
  '{"text":"must not be created","language":"en","priority":0,"isFavorite":false,"isTracked":false,"tagNames":[]}'
expect_status 403 semantics-write-denied

token_call GET "projects/$project_alpha/tracking-contexts"
expect_status 403 positions-read-denied

token_call GET "workspaces/$workspace_id/api-tokens"
expect_status 403 token-management-denied

token_call GET \
  "workspaces/01900000-0000-7000-8000-00000000ffff/projects"
expect_status 403 cross-workspace-denied

response_status=$(
  curl \
    --insecure \
    --silent \
    --show-error \
    --max-time 20 \
    --request GET \
    --header "Authorization: Bearer seo_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
    --cookie "$cookie_jar" \
    --output "$response_body" \
    --write-out '%{http_code}' \
    "$api_base/workspaces/$workspace_id/projects"
)
expect_status 401 invalid-bearer-does-not-fallback-to-cookie

all_scope_input='{
  "name": "Full workspace agent",
  "scopes": [
    "projects:read",
    "projects:write",
    "semantics:read",
    "semantics:write",
    "positions:read",
    "positions:run"
  ],
  "allProjects": true,
  "projectIds": [],
  "expiresAt": null
}'
session_call PATCH \
  "workspaces/$workspace_id/api-tokens/$token_id" \
  "$all_scope_input" \
  "$token_version"
expect_status 200 api-token-rights-update
token_version=$(jq -er '.data.version' "$response_body")

token_call GET access
expect_status 200 expanded-access-discovery
jq -e \
  --arg alpha "$project_alpha" \
  --arg beta "$project_beta" \
  '.data.token.allProjects == true and
   (.data.token.scopes | index("positions:run") != null) and
   (.data.projects | length == 2 and .[0].id == $alpha and .[1].id == $beta)' \
  "$response_body" >/dev/null ||
  runtime_fail "access discovery did not apply updated token rights"

token_call POST "projects/$project_beta/keywords" \
  '{"text":"created through public api","language":"en","priority":10,"isFavorite":true,"isTracked":true,"tagNames":["agent"]}'
expect_status 201 semantics-write-after-update

incomplete_order=$(
  jq -cn \
    --arg alpha "$project_alpha" \
    '{expectedProjectIds: [$alpha], projectIds: [$alpha]}'
)
token_call PUT \
  "workspaces/$workspace_id/projects/order" \
  "$incomplete_order"
expect_status 412 incomplete-observation-rejected

valid_order=$(
  jq -cn \
    --arg alpha "$project_alpha" \
    --arg beta "$project_beta" \
    '{
      expectedProjectIds: [$alpha, $beta],
      projectIds: [$beta, $alpha]
    }'
)
token_call PUT \
  "workspaces/$workspace_id/projects/order" \
  "$valid_order"
expect_status 200 project-order-update
jq -e \
  --arg alpha "$project_alpha" \
  --arg beta "$project_beta" \
  '.data.projectIds == [$beta, $alpha]' \
  "$response_body" >/dev/null ||
  runtime_fail "project order response is incomplete"

token_call PUT \
  "workspaces/$workspace_id/projects/order" \
  "$valid_order"
expect_status 412 stale-project-order-rejected

session_call GET "workspaces/$workspace_id/projects"
expect_status 200 shared-project-order-visible
jq -e \
  --arg alpha "$project_alpha" \
  --arg beta "$project_beta" \
  '.data[0].id == $beta and .data[1].id == $alpha' \
  "$response_body" >/dev/null ||
  runtime_fail "shared project order was not persisted"

tracking_context_input='{
  "name": "API Yandex Moscow Desktop",
  "configuration": {
    "searchEngine": "YANDEX",
    "countryCode": "RU",
    "regionCode": "213",
    "regionLabel": "Москва",
    "language": "ru",
    "device": "DESKTOP",
    "depth": 50,
    "domainMatchRule": {"mode": "EXACT_HOST"},
    "safeSearch": false
  },
  "launchProfile": {
    "searchSource": "LIVE",
    "includeUntracked": false,
    "scope": {"mode": "ALL", "groupIds": []}
  }
}'
token_call POST \
  "projects/$project_alpha/tracking-contexts" \
  "$tracking_context_input" \
  "public-api-context-$(openssl rand -hex 12)"
expect_status 201 tracking-context-create
tracking_context_id=$(jq -er '.data.id' "$response_body")

token_call GET "projects/$project_alpha/tracking-contexts"
expect_status 200 tracking-context-read
jq -e \
  --arg id "$tracking_context_id" \
  '.data.contexts | any(.id == $id)' \
  "$response_body" >/dev/null ||
  runtime_fail "created tracking context is missing"

estimate_input=$(
  jq -cn \
    --arg id "$tracking_context_id" \
    '{trackingContextId: $id, provider: "XMLSTOCK", searchSource: "LIVE"}'
)
token_call POST \
  "projects/$project_alpha/rank-estimates" \
  "$estimate_input" \
  "public-api-estimate-$(openssl rand -hex 12)"
expect_status 201 rank-estimate-via-api
estimate_id=$(jq -er '.data.id' "$response_body")
estimate_charge=$(jq -er '.data.platformChargeMicro' "$response_body")
jq -e \
  '.data.status == "READY" or .data.status == "BLOCKED"' \
  "$response_body" >/dev/null ||
  runtime_fail "rank estimate returned an invalid state"

rank_run_input=$(
  jq -cn \
    --arg id "$estimate_id" \
    --arg charge "$estimate_charge" \
    '{estimateId: $id, confirmedPlatformChargeMicro: $charge}'
)
token_call POST \
  "projects/$project_alpha/rank-runs" \
  "$rank_run_input" \
  "public-api-rank-run-$(openssl rand -hex 12)"
case "$response_status" in
  202)
    expect_status 202 rank-run-create
    ;;
  402|409)
    jq -e \
      '.error.code == "RESOURCE_STATE_CONFLICT" or .error.code == "PAYMENT_REQUIRED"' \
      "$response_body" >/dev/null ||
      runtime_fail "rank run returned an unexpected business blocker"
    printf 'public-api-smoke operation=rank-run-business-blocker status=%s\n' \
      "$response_status"
    ;;
  *)
    fail_test rank-run-create-or-explicit-business-blocker "202, 402 or 409"
    ;;
esac

session_call POST \
  "workspaces/$workspace_id/api-tokens/$token_id/rotate" \
  '{}' \
  "$token_version"
expect_status 201 api-token-rotate
rotated_token=$(jq -er '.data.token' "$response_body")
token_version=$(jq -er '.data.version' "$response_body")

token_call GET \
  "projects/$project_alpha/keywords?limit=5" \
  '' \
  '' \
  "$api_token"
expect_status 200 previous-secret-grace-window
token_call GET \
  "projects/$project_alpha/keywords?limit=5" \
  '' \
  '' \
  "$rotated_token"
expect_status 200 rotated-secret-active

session_call POST \
  "workspaces/$workspace_id/api-tokens/$token_id/revoke" \
  '{}' \
  "$token_version"
expect_status 201 api-token-revoke

token_call GET \
  "projects/$project_alpha/keywords?limit=5" \
  '' \
  '' \
  "$api_token"
expect_status 401 previous-secret-revoked
token_call GET \
  "projects/$project_alpha/keywords?limit=5" \
  '' \
  '' \
  "$rotated_token"
expect_status 401 current-secret-revoked

printf '%s\n' \
  "public-api-smoke result=passed projects=2 token_lifecycle=complete"
