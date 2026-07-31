#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

[ "${SEO_PLATFORM_SMOKE_CONFIRM:-}" = "CREATE_TEST_DATA" ] ||
  runtime_fail "set SEO_PLATFORM_SMOKE_CONFIRM=CREATE_TEST_DATA to run the mutating smoke test"

load_runtime_environment

smoke_root=$(mktemp -d)
case "$smoke_root" in
  /tmp/tmp.*) ;;
  *) runtime_fail "mktemp returned an unexpected path" ;;
esac
trap 'rm -rf -- "$smoke_root"' EXIT INT TERM

cookie_jar=$smoke_root/cookies.txt
response_body=$smoke_root/response.json
smoke_email="smoke-$(date -u +%Y%m%d%H%M%S)-$$@example.invalid"
smoke_password="S$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)!9a"
smoke_crawl_url=${SEO_PLATFORM_SMOKE_CRAWL_URL:-https://example.com/}
smoke_sitemap_url=${SEO_PLATFORM_SMOKE_SITEMAP_URL:-}
smoke_include_pattern=${SEO_PLATFORM_SMOKE_INCLUDE_PATTERN:-}
smoke_project_domain=$(
  SMOKE_CRAWL_URL="$smoke_crawl_url" \
    /home/dev/.nvm/versions/node/v24.18.1/bin/node <<'NODE'
const url = new URL(process.env.SMOKE_CRAWL_URL);
if (
  !["http:", "https:"].includes(url.protocol) ||
  url.username ||
  url.password ||
  url.hash ||
  (url.port &&
    !(
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ))
) {
  process.exit(1);
}
process.stdout.write(url.hostname);
NODE
) || runtime_fail "SEO_PLATFORM_SMOKE_CRAWL_URL is invalid"
csrf_token=
response_status=

api_call() {
  local method=$1
  local path=$2
  local body=${3:-}
  local idempotency_key=${4:-}
  local if_match=${5:-}
  local request_arguments=(
    --silent
    --show-error
    --max-time 20
    --request "$method"
    --header "Accept: application/json"
    --header "Origin: $SEO_PLATFORM_PUBLIC_URL"
    --cookie "$cookie_jar"
    --cookie-jar "$cookie_jar"
    --output "$response_body"
    --write-out '%{http_code}'
  )

  if [ -n "$csrf_token" ] && [ "$method" != GET ]; then
    request_arguments+=(--header "X-CSRF-Token: $csrf_token")
  fi
  if [ -n "$idempotency_key" ]; then
    request_arguments+=(--header "Idempotency-Key: $idempotency_key")
  fi
  if [ -n "$if_match" ]; then
    request_arguments+=(--header "If-Match: \"v$if_match\"")
  fi
  if [ -n "$body" ]; then
    request_arguments+=(
      --header "Content-Type: application/json"
      --data-binary @-
    )
    response_status=$(
      printf '%s' "$body" |
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

expect_status() {
  local expected=$1
  local operation=$2
  if [ "$response_status" != "$expected" ]; then
    printf 'seo-platform-vps-smoke: operation=%s expected=%s actual=%s\n' \
      "$operation" \
      "$expected" \
      "$response_status" >&2
    jq -c '{error: (.error // "invalid response")}' "$response_body" >&2 ||
      true
    exit 1
  fi
  printf 'smoke operation=%s status=%s\n' "$operation" "$response_status"
}

register_body=$(
  jq -cn \
    --arg email "$smoke_email" \
    --arg password "$smoke_password" \
    '{
      email: $email,
      password: $password,
      displayName: "VPS Runtime Smoke",
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
api_call POST auth/register "$register_body"
expect_status 201 register
csrf_token=$(
  awk '$6 == "seo_csrf" { print $7 }' "$cookie_jar" | tail -1
)
[ -n "$csrf_token" ] || runtime_fail "registration did not issue a CSRF cookie"

api_call GET me
expect_status 200 current-account

api_call POST workspaces \
  '{"name":"VPS Runtime Smoke","country":"DE","locale":"ru","timezone":"Europe/Berlin","billingCurrency":"RUB"}'
expect_status 201 create-workspace
workspace_id=$(jq -er '.data.id' "$response_body")

api_call POST "workspaces/$workspace_id/billing/trial" \
  '' \
  "smoke-trial-$(openssl rand -hex 16)"
expect_status 201 start-trial

project_body=$(
  jq -cn \
    --arg domain "$smoke_project_domain" \
    '{
      name: "VPS Runtime Smoke Project",
      domain: $domain,
      locale: "ru",
      timezone: "Europe/Berlin"
    }'
)
api_call POST "workspaces/$workspace_id/projects" "$project_body"
expect_status 201 create-project
project_id=$(jq -er '.data.id' "$response_body")

api_call POST "projects/$project_id/keywords" \
  '{"text":"seo platform smoke keyword","language":"en","priority":50,"isFavorite":true,"intent":"INFORMATIONAL","tagNames":["smoke"]}'
expect_status 201 create-keyword
keyword_id=$(jq -er '.data.id' "$response_body")

api_call GET "workspaces/$workspace_id/integrations/catalog"
expect_status 200 integration-catalog
jq -e '.data | length > 0' "$response_body" >/dev/null ||
  runtime_fail "integration catalog is empty"

api_call GET "workspaces/$workspace_id/members"
expect_status 200 team-members
jq -e '.data | length == 1' "$response_body" >/dev/null ||
  runtime_fail "new workspace must contain exactly its owner"

api_call GET "workspaces/$workspace_id/billing/subscription"
expect_status 200 billing-subscription
[ "$(jq -r '.data.status' "$response_body")" = TRIALING ] ||
  runtime_fail "trial subscription is not active"

crawl_body=$(
  jq -cn \
    --arg startUrl "$smoke_crawl_url" \
    --arg sitemapUrl "$smoke_sitemap_url" \
    --arg includePattern "$smoke_include_pattern" \
    '{
      startUrls: [$startUrl],
      sitemapUrls: (
        if $sitemapUrl == "" then [] else [$sitemapUrl] end
      ),
      includePatterns: (
        if $includePattern == "" then [] else [$includePattern] end
      ),
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 3,
      maxDepth: 1,
      requestsPerMinute: 60,
      obeyRobots: true
    }'
)
api_call POST "projects/$project_id/crawls" \
  "$crawl_body" \
  "smoke-crawl-$(openssl rand -hex 16)"
expect_status 202 create-crawl
crawl_id=$(jq -er '.data.id' "$response_body")

crawl_status=QUEUED
for ((attempt = 1; attempt <= 45; attempt += 1)); do
  api_call GET "projects/$project_id/crawls/$crawl_id"
  expect_status 200 read-crawl
  crawl_status=$(jq -er '.data.status' "$response_body")
  case "$crawl_status" in
    COMPLETED|PARTIALLY_COMPLETED) break ;;
    FAILED|CANCELLED) runtime_fail "crawl finished with status $crawl_status" ;;
  esac
  sleep 2
done
case "$crawl_status" in
  COMPLETED|PARTIALLY_COMPLETED) ;;
  *) runtime_fail "crawl did not complete before the smoke timeout" ;;
esac

processed_urls=$(jq -er '.data.processedUrls' "$response_body")
[ "$processed_urls" -gt 0 ] ||
  runtime_fail "crawl completed without processing a page"

api_call GET "projects/$project_id/crawl-issues"
expect_status 200 crawl-issues

api_call GET "projects/$project_id/crawl-changes"
expect_status 200 crawl-changes
jq -e '.data.changes | type == "array"' "$response_body" >/dev/null ||
  runtime_fail "crawl change history is not an array"

semantic_file=$smoke_root/semantic-smoke.xlsx
SEMANTIC_FIXTURE="$semantic_file" \
FFLATE_MODULE="$project_root/platform-jobs-integrations/node_modules/fflate" \
  /home/dev/.nvm/versions/node/v24.18.1/bin/node <<'NODE'
const { writeFileSync } = require("node:fs");
const { strToU8, zipSync } = require(process.env.FFLATE_MODULE);
const xml = (value) =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);
const files = {
  "[Content_Types].xml": xml(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      "</Types>"
  ),
  "_rels/.rels": xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"
  ),
  "xl/workbook.xml": xml(
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" +
      '<sheet name="Служебный" sheetId="1" state="hidden" r:id="rId1"/>' +
      '<sheet name="Key Collector" sheetId="2" r:id="rId2"/>' +
      "</sheets></workbook>"
  ),
  "xl/_rels/workbook.xml.rels": xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      "</Relationships>"
  ),
  "xl/sharedStrings.xml": xml(
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">' +
      "<si><t>Не импортировать</t></si><si><t>Фраза</t></si>" +
      "<si><t>Группа</t></si><si><t>Частотность</t></si>" +
      "<si><t>продвижение сайта</t></si><si><t>Коммерция</t></si>" +
      "<si><t>seo аудит</t></si><si><t>Аудит</t></si></sst>"
  ),
  "xl/worksheets/sheet1.xml": xml(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'
  ),
  "xl/worksheets/sheet2.xml": xml(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><f>10*12</f><v>120</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3"><v>70</v></c></row>' +
      "</sheetData></worksheet>"
  )
};
writeFileSync(process.env.SEMANTIC_FIXTURE, Buffer.from(zipSync(files)), {
  mode: 0o600
});
NODE
semantic_size=$(
  LC_ALL=C wc -c < "$semantic_file" |
    tr -d '[:space:]'
)
api_call POST "projects/$project_id/uploads" \
  "{\"fileName\":\"semantic-smoke.xlsx\",\"mediaType\":\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\",\"sizeBytes\":\"$semantic_size\"}" \
  "smoke-upload-$(openssl rand -hex 16)"
expect_status 201 create-semantic-upload
upload_id=$(jq -er '.data.upload.id' "$response_body")
[ "$(jq -er '.data.partCount' "$response_body")" = 1 ] ||
  runtime_fail "semantic smoke fixture unexpectedly requires multiple parts"

api_call POST "projects/$project_id/uploads/$upload_id/parts" \
  '{"partNumbers":[1]}'
expect_status 201 create-upload-part-url
part_url=$(jq -er '.data.parts[0].url' "$response_body")
expected_storage_endpoint=$(public_storage_endpoint)
case "$part_url" in
  "$expected_storage_endpoint"/*) ;;
  *) runtime_fail "signed upload URL does not use the public storage endpoint" ;;
esac

preflight_headers=$smoke_root/preflight.headers
preflight_status=$(
  curl \
    --silent \
    --show-error \
    --max-time 20 \
    --request OPTIONS \
    --header "Origin: $SEO_PLATFORM_PUBLIC_URL" \
    --header 'Access-Control-Request-Method: PUT' \
    --header 'Access-Control-Request-Headers: content-type' \
    --dump-header "$preflight_headers" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$part_url"
)
case "$preflight_status" in
  200|204) ;;
  *) runtime_fail "object-storage CORS preflight returned $preflight_status" ;;
esac
grep -Fqi "access-control-allow-origin: $SEO_PLATFORM_PUBLIC_URL" \
  "$preflight_headers" ||
  runtime_fail "object-storage CORS did not allow the public application origin"
printf 'smoke operation=object-storage-cors status=%s\n' "$preflight_status"

part_headers=$smoke_root/upload-part.headers
part_status=$(
  curl \
    --silent \
    --show-error \
    --max-time 30 \
    --request PUT \
    --header "Origin: $SEO_PLATFORM_PUBLIC_URL" \
    --header 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' \
    --data-binary @"$semantic_file" \
    --dump-header "$part_headers" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$part_url"
)
[ "$part_status" = 200 ] ||
  runtime_fail "uploading the semantic fixture returned $part_status"
part_etag=$(
  awk 'tolower($1) == "etag:" { gsub(/\r/, "", $2); print $2 }' \
    "$part_headers" |
    tail -1
)
[ -n "$part_etag" ] ||
  runtime_fail "object storage did not return the uploaded part ETag"
printf 'smoke operation=upload-semantic-part status=%s\n' "$part_status"

complete_body=$(
  jq -cn \
    --arg etag "$part_etag" \
    '{parts: [{partNumber: 1, etag: $etag}]}'
)
api_call POST "projects/$project_id/uploads/$upload_id/complete" \
  "$complete_body"
expect_status 201 complete-semantic-upload

upload_status=UPLOADED
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  api_call GET "projects/$project_id/uploads/$upload_id"
  expect_status 200 inspect-semantic-upload
  upload_status=$(jq -er '.data.status' "$response_body")
  case "$upload_status" in
    READY) break ;;
    REJECTED|ABORTED|EXPIRED)
      runtime_fail "semantic upload inspection finished with status $upload_status"
      ;;
  esac
  sleep 2
done
[ "$upload_status" = READY ] ||
  runtime_fail "semantic upload inspection did not complete before the smoke timeout"

api_call POST "projects/$project_id/imports" \
  "{\"uploadId\":\"$upload_id\"}" \
  "smoke-import-$(openssl rand -hex 16)"
expect_status 201 create-semantic-import
semantic_import_id=$(jq -er '.data.id' "$response_body")

import_status=QUEUED
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  api_call GET "projects/$project_id/imports/$semantic_import_id"
  expect_status 200 parse-semantic-import
  import_status=$(jq -er '.data.status' "$response_body")
  case "$import_status" in
    AWAITING_MAPPING) break ;;
    FAILED|CANCELLED)
      runtime_fail "semantic import parsing finished with status $import_status"
      ;;
  esac
  sleep 2
done
[ "$import_status" = AWAITING_MAPPING ] ||
  runtime_fail "semantic import parsing did not complete before the smoke timeout"
import_version=$(jq -er '.data.version' "$response_body")
mapping_columns=$(
  jq -c '
    [
      .data.preview.columns[] |
      {
        sourceIndex: .index,
        target: .suggestedTarget
      } +
      if .suggestedTarget == "custom"
      then {customName: .sourceName}
      else {}
      end
    ]
  ' "$response_body"
)
jq -e 'map(select(.target == "keyword.text")) | length == 1' \
  <<< "$mapping_columns" >/dev/null ||
  runtime_fail "semantic parser did not identify exactly one keyword column"
mapping_body=$(
  jq -cn \
    --argjson columns "$mapping_columns" \
    '{
      columns: $columns,
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "SKIP_EXISTING"
    }'
)
api_call POST \
  "projects/$project_id/imports/$semantic_import_id/mapping" \
  "$mapping_body" \
  '' \
  "$import_version"
expect_status 201 validate-semantic-import

import_status=VALIDATING
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  api_call GET "projects/$project_id/imports/$semantic_import_id"
  expect_status 200 read-semantic-validation
  import_status=$(jq -er '.data.status' "$response_body")
  case "$import_status" in
    AWAITING_CONFIRMATION) break ;;
    FAILED|CANCELLED)
      runtime_fail "semantic import validation finished with status $import_status"
      ;;
  esac
  sleep 2
done
[ "$import_status" = AWAITING_CONFIRMATION ] ||
  runtime_fail "semantic import validation did not complete before the smoke timeout"
[ "$(jq -er '.data.validation.uniqueKeywordsToProcess' "$response_body")" -ge 2 ] ||
  runtime_fail "semantic validation did not retain the fixture keywords"
import_version=$(jq -er '.data.version' "$response_body")

api_call POST \
  "projects/$project_id/imports/$semantic_import_id/publish" \
  '' \
  '' \
  "$import_version"
expect_status 201 publish-semantic-import

import_status=READY_TO_PUBLISH
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  api_call GET "projects/$project_id/imports/$semantic_import_id"
  expect_status 200 read-semantic-publication
  import_status=$(jq -er '.data.status' "$response_body")
  case "$import_status" in
    COMPLETED) break ;;
    FAILED|CANCELLED)
      runtime_fail "semantic import publication finished with status $import_status"
      ;;
  esac
  sleep 2
done
[ "$import_status" = COMPLETED ] ||
  runtime_fail "semantic import publication did not complete before the smoke timeout"
[ "$(jq -er '.data.result.createdKeywords' "$response_body")" -ge 2 ] ||
  runtime_fail "semantic import did not create the fixture keywords"

api_call GET "projects/$project_id/keywords?pageSize=100"
expect_status 200 list-imported-keywords
jq -e '
  [.data[] | .textOriginal] as $keywords |
  ($keywords | index("продвижение сайта")) != null and
  ($keywords | index("seo аудит")) != null
' "$response_body" >/dev/null ||
  runtime_fail "published semantic keywords are missing from the project"

printf 'smoke result=passed workspace=%s project=%s keyword=%s crawl=%s crawl_status=%s processed_urls=%s upload=%s import=%s import_status=%s\n' \
  "$workspace_id" \
  "$project_id" \
  "$keyword_id" \
  "$crawl_id" \
  "$crawl_status" \
  "$processed_urls" \
  "$upload_id" \
  "$semantic_import_id" \
  "$import_status"
