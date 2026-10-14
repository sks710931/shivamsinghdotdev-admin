#!/usr/bin/env bash
set -euo pipefail

# Guard: Validate base URL before any HTTP request
validate_smoke_url() {
  local url="$1"
  local scheme authority remainder host port

  if [[ ! "$url" =~ ^([a-zA-Z][a-zA-Z0-9+.-]*)://(.*)$ ]]; then
    printf 'ERROR: Invalid base URL "%s". Scheme must be http or https.\n' "$url" >&2
    exit 2
  fi
  scheme="${BASH_REMATCH[1],,}"
  if [[ "$scheme" != "http" && "$scheme" != "https" ]]; then
    printf 'ERROR: Invalid scheme "%s" in base URL "%s". Only http and https are allowed.\n' "$scheme" "$url" >&2
    exit 2
  fi

  remainder="${BASH_REMATCH[2]}"
  authority="${remainder%%[/?#]*}"

  if [[ -z "$authority" ]]; then
    printf 'ERROR: Empty authority in base URL "%s".\n' "$url" >&2
    exit 2
  fi

  if [[ "$authority" == *"@"* ]]; then
    printf 'ERROR: Userinfo (@) is not allowed in base URL authority "%s".\n' "$authority" >&2
    exit 2
  fi

  if [[ "$authority" =~ ^(\[[^]]+\])(:(.*))?$ ]]; then
    host="${BASH_REMATCH[1]}"
    if [[ -n "${BASH_REMATCH[2]:-}" && -z "${BASH_REMATCH[3]:-}" ]]; then
      printf 'ERROR: Empty port in base URL authority "%s".\n' "$authority" >&2
      exit 2
    fi
    port="${BASH_REMATCH[3]:-}"
  elif [[ "$authority" =~ ^([^:]+)(:(.*))?$ ]]; then
    host="${BASH_REMATCH[1]}"
    if [[ -n "${BASH_REMATCH[2]:-}" && -z "${BASH_REMATCH[3]:-}" ]]; then
      printf 'ERROR: Empty port in base URL authority "%s".\n' "$authority" >&2
      exit 2
    fi
    port="${BASH_REMATCH[3]:-}"
  else
    printf 'ERROR: Invalid authority "%s" in base URL "%s".\n' "$authority" "$url" >&2
    exit 2
  fi

  if [[ -n "$port" ]]; then
    if [[ ! "$port" =~ ^[0-9]+$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
      printf 'ERROR: Invalid port "%s" in base URL "%s". Port must be an integer between 1 and 65535.\n' "$port" "$url" >&2
      exit 2
    fi
  fi

  local host_lower="${host,,}"
  if [[ "$host_lower" != "localhost" && "$host" != "127.0.0.1" && "$host" != "[::1]" ]]; then
    printf 'ERROR: Untrusted host "%s" in base URL "%s". Only localhost, 127.0.0.1, and [::1] are allowed.\n' "$host" "$url" >&2
    exit 2
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/.env.local}"

read_env() {
  local key="$1"
  local line trimmed keypart raw value first lastc
  local found=0
  local last=""

  if [[ ! -f "$ENV_FILE" ]]; then
    return 1
  fi

  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    line="${line%$'\r'}"
    trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    if [[ -z "$trimmed" || "$trimmed" == \#* ]]; then
      continue
    fi
    if [[ "$trimmed" != *=* ]]; then
      continue
    fi

    keypart="${trimmed%%=*}"
    keypart="${keypart%"${keypart##*[![:space:]]}"}"
    keypart="${keypart#"${keypart%%[![:space:]]*}"}"
    if [[ "$keypart" != "$key" ]]; then
      continue
    fi

    raw="${trimmed#*=}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    value="$raw"
    if [[ ${#value} -ge 2 ]]; then
      first="${value:0:1}"
      lastc="${value: -1}"
      if [[ ( "$first" == '"' && "$lastc" == '"' ) || ( "$first" == "'" && "$lastc" == "'" ) ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    last="$value"
    found=1
  done < "$ENV_FILE"

  if [[ "$found" -ne 1 ]]; then
    return 1
  fi
  printf '%s' "$last"
}

BASE="${APP_URL:-}"
if [[ -z "$BASE" && -f "$ENV_FILE" ]]; then
  BASE="$(read_env APP_URL || true)"
fi
BASE="${BASE:-http://localhost:3000}"
BASE="${BASE%/}"

validate_smoke_url "$BASE"

for arg in "$@"; do
  if [[ "$arg" == "--check-host-only" ]]; then
    printf 'OK: Base URL host guard passed for %s\n' "$BASE"
    exit 0
  fi
done

cd "$ROOT"

assign_required() {
  local key="$1"
  local name="$2"
  local value=""
  if ! value="$(read_env "$key")" || [[ -z "$value" ]]; then
    printf 'FAIL %s is not set in .env.local\n' "$key"
    exit 1
  fi
  printf -v "$name" '%s' "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'FAIL .env.local is missing\n'
  exit 1
fi

assign_required ADMIN_EMAIL admin_email
assign_required ADMIN_PASSWORD admin_password
assign_required LOCAL_GUEST_PASSWORD guest_password

cookie_dir="$(mktemp -d)"
trap 'rm -rf "$cookie_dir"' EXIT
admin_jar="${cookie_dir}/admin.cookies"
guest_jar="${cookie_dir}/guest.cookies"
: > "$admin_jar"
: > "$guest_jar"

failed=0

mask() {
  local id="${1:-}"
  if [[ $# -eq 0 ]]; then
    id="$(cat)"
  fi
  printf '%s...' "${id:0:8}"
}

mask_id() {
  mask "$@"
}

record() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    while [[ "$label" =~ ([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12} ]]; do
      label="${label//${BASH_REMATCH[0]}/$(mask "${BASH_REMATCH[0]}")}"
    done
    printf 'PASS %s\n' "$label"
  else
    while [[ "$label" =~ ([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12} ]]; do
      label="${label//${BASH_REMATCH[0]}/$(mask "${BASH_REMATCH[0]}")}"
    done
    while [[ "$expected" =~ ([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12} ]]; do
      expected="${expected//${BASH_REMATCH[0]}/$(mask "${BASH_REMATCH[0]}")}"
    done
    while [[ "$actual" =~ ([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12} ]]; do
      actual="${actual//${BASH_REMATCH[0]}/$(mask "${BASH_REMATCH[0]}")}"
    done
    printf 'FAIL %s (expected %s, got %s)\n' "$label" "$expected" "$actual"
    failed=1
    exit 1
  fi
}

call_api() {
  local resp_out="$1"
  shift
  local code
  code="$(curl -sS --max-time 20 -o "$resp_out" -w '%{http_code}' "$@" || true)"
  if [[ -z "$code" ]]; then
    code="000"
  fi
  printf '%s' "$code"
}

extract_json() {
  local filter="$1"
  local file="$2"
  local val=""
  val="$(jq -r "$filter" "$file" 2>/dev/null || true)"
  printf '%s' "$val"
}

http_code() {
  local code
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$@" || true)"
  if [[ -z "$code" ]]; then
    code="000"
  fi
  printf '%s' "$code"
}

login_code() {
  local jar="$1"
  local email="$2"
  local password="$3"
  local payload=""
  if ! payload="$(
    SMOKE_EMAIL="$email" SMOKE_PASSWORD="$password" node --input-type=module -e \
      'process.stdout.write(JSON.stringify({email:process.env.SMOKE_EMAIL,password:process.env.SMOKE_PASSWORD}))'
  )"; then
    printf '000'
    return 0
  fi
  http_code \
    -c "$jar" \
    -b "$jar" \
    -H "Origin: ${BASE}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data-binary "$payload" \
    "${BASE}/api/auth/login"
}

record "unauthenticated GET /api/posts" "401" "$(http_code "${BASE}/api/posts")"
record "admin login" "200" "$(login_code "$admin_jar" "$admin_email" "$admin_password")"
record "admin GET /api/posts" "200" "$(http_code -b "$admin_jar" "${BASE}/api/posts")"
record "guest login" "200" "$(login_code "$guest_jar" "guest@localhost.test" "$guest_password")"
record "guest GET /api/posts" "200" "$(http_code -b "$guest_jar" "${BASE}/api/posts")"
record "guest GET /api/posts/$(mask "00000000-0000-0000-0000-000000000000")" "404" \
  "$(http_code -b "$guest_jar" "${BASE}/api/posts/00000000-0000-0000-0000-000000000000")"

other_post_id=""
if other_post_id="$(read_env TEST_OTHER_POST_ID)" && [[ -n "$other_post_id" ]]; then
  record "guest GET /api/posts/$(mask "$other_post_id")" "404" \
    "$(http_code -b "$guest_jar" "${BASE}/api/posts/${other_post_id}")"
  record "admin GET /api/posts/$(mask "$other_post_id")" "200" \
    "$(http_code -b "$admin_jar" "${BASE}/api/posts/${other_post_id}")"
  record "guest GET /api/posts/$(mask "$other_post_id")/revision" "404" \
    "$(http_code -b "$guest_jar" "${BASE}/api/posts/${other_post_id}/revision")"
  # A draft has no pending revision, so admin sees the post but not a revision.
  record "admin GET /api/posts/$(mask "$other_post_id")/revision" "404" \
    "$(http_code -b "$admin_jar" "${BASE}/api/posts/${other_post_id}/revision")"
  record "unauthenticated GET /api/posts/$(mask "$other_post_id")" "401" \
    "$(http_code "${BASE}/api/posts/${other_post_id}")"
else
  printf 'SKIP guest GET /api/posts/$TEST_OTHER_POST_ID (TEST_OTHER_POST_ID is not set)\n'
  printf 'SKIP admin GET /api/posts/$TEST_OTHER_POST_ID (TEST_OTHER_POST_ID is not set)\n'
  printf 'SKIP guest GET /api/posts/$TEST_OTHER_POST_ID/revision (TEST_OTHER_POST_ID is not set)\n'
  printf 'SKIP admin GET /api/posts/$TEST_OTHER_POST_ID/revision (TEST_OTHER_POST_ID is not set)\n'
  printf 'SKIP unauthenticated GET /api/posts/$TEST_OTHER_POST_ID (TEST_OTHER_POST_ID is not set)\n'
fi

# -----------------------------------------------------------------------------
# Posts API workflow (contract v1.2)
# -----------------------------------------------------------------------------

resp_json="${cookie_dir}/resp.json"
slug_suffix="$(date +%s)-$RANDOM"
slug="smoke-post-${slug_suffix}"
title="Smoke Post ${slug_suffix}"

# Assert unauthenticated POST /api/posts is rejected (401)
dummy_version="AAAAAAAAAAA="
dummy_payload="$(jq -n --arg version "$dummy_version" '{version: $version}')"
dummy_post_payload="$(jq -n \
  --arg title "Unauth post" \
  --arg slug "unauth-${slug_suffix}" \
  --arg bodyHtml "<p>body</p>" \
  '{title: $title, slug: $slug, bodyHtml: $bodyHtml}')"

record "unauthenticated POST /api/posts" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_post_payload" "${BASE}/api/posts")"

# 1. Create article
create_payload="$(jq -n \
  --arg title "$title" \
  --arg slug "$slug" \
  --arg summary "Initial smoke draft summary" \
  --arg tags "smoke,contract" \
  --arg seoTitle "Smoke SEO Title" \
  --arg seoKeywords "smoke,test" \
  --arg bodyHtml "<p>Initial smoke draft body content</p>" \
  '{title: $title, slug: $slug, summary: $summary, tags: $tags, seoTitle: $seoTitle, seoKeywords: $seoKeywords, bodyHtml: $bodyHtml}')"

code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$create_payload" "${BASE}/api/posts")"
record "admin create article" "201" "$code"

post_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$post_id" ]]; then
  printf 'FAIL expected created article to return an id\n'
  exit 1
fi

# Assert unauthenticated requests to mutating endpoints are rejected (401)
record "unauthenticated PATCH /api/posts/[id]" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}")"
record "unauthenticated POST /api/posts/[id]/publish" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/publish")"
record "unauthenticated POST /api/posts/[id]/revision/publish" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/revision/publish")"
record "unauthenticated DELETE /api/posts/[id]/revision" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X DELETE --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/revision")"
record "unauthenticated POST /api/posts/[id]/unpublish" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/unpublish")"
record "unauthenticated POST /api/posts/[id]/archive" "401" \
  "$(http_code -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/archive")"

# Assert guest requests to admin mutating endpoints are rejected (403)
record "guest POST /api/posts/[id]/publish" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/publish")"
record "guest POST /api/posts/[id]/revision/publish" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/revision/publish")"
record "guest DELETE /api/posts/[id]/revision" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X DELETE --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/revision")"
record "guest POST /api/posts/[id]/unpublish" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/unpublish")"
record "guest POST /api/posts/[id]/archive" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$dummy_payload" "${BASE}/api/posts/${post_id}/archive")"

guest_force_payload="$(jq -n --arg version "$dummy_version" '{version: $version, force: true}')"
record "guest PATCH /api/posts/[id] with force:true" "403" \
  "$(http_code -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$guest_force_payload" "${BASE}/api/posts/${post_id}")"

# 2. Save draft (PATCH with version)
# Get initial post version
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${post_id}")"
record "admin GET /api/posts/[id] for initial draft version" "200" "$code"
v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v0" ]]; then
  printf 'FAIL expected post to have a version\n'
  exit 1
fi

save_draft_payload="$(jq -n \
  --arg version "$v0" \
  --arg summary "Saved draft summary" \
  --arg bodyHtml "<p>Saved draft body content</p>" \
  '{version: $version, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$save_draft_payload" "${BASE}/api/posts/${post_id}")"
record "admin save draft (PATCH with version)" "200" "$code"
v1="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v1" || "$v1" == "$v0" ]]; then
  printf 'FAIL expected save draft to return an updated version\n'
  exit 1
fi

# 3. Reopen (GET)
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${post_id}")"
record "admin reopen (GET)" "200" "$code"
reopened_status="$(extract_json '.status // empty' "$resp_json")"
reopened_summary="$(extract_json '.summary // empty' "$resp_json")"
reopened_version="$(extract_json '.version // empty' "$resp_json")"
record "reopened post status is draft" "draft" "$reopened_status"
record "reopened post summary matches" "Saved draft summary" "$reopened_summary"
if [[ "$reopened_version" != "$v1" ]]; then
  printf 'FAIL expected reopened version to match saved version\n'
  exit 1
fi

# 4. Edit+save
edit_save_payload="$(jq -n \
  --arg version "$reopened_version" \
  --arg title "Smoke Post Edited" \
  --arg bodyHtml "<p>Edited and saved body content</p>" \
  '{version: $version, title: $title, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$edit_save_payload" "${BASE}/api/posts/${post_id}")"
record "admin edit+save" "200" "$code"
v2="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v2" || "$v2" == "$reopened_version" ]]; then
  printf 'FAIL expected edit+save to return an updated version\n'
  exit 1
fi

# 5. Verify a stale version returns 409
stale_payload="$(jq -n \
  --arg version "$v0" \
  --arg title "Stale edit should fail" \
  '{version: $version, title: $title}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$stale_payload" "${BASE}/api/posts/${post_id}")"
record "admin verify a stale version returns 409" "409" "$code"
stale_error_code="$(extract_json '.code // empty' "$resp_json")"
record "stale version error code is stale_version" "stale_version" "$stale_error_code"

# 6. Preview
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${post_id}")"
record "admin preview (GET)" "200" "$code"
preview_title="$(extract_json '.title // empty' "$resp_json")"
preview_status="$(extract_json '.status // empty' "$resp_json")"
preview_version="$(extract_json '.version // empty' "$resp_json")"
record "preview post title matches edited" "Smoke Post Edited" "$preview_title"
record "preview post status is draft" "draft" "$preview_status"
if [[ "$preview_version" != "$v2" ]]; then
  printf 'FAIL expected preview post version to match v2\n'
  exit 1
fi

# 7. Publish (draft only)
publish_payload="$(jq -n --arg version "$v2" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$publish_payload" "${BASE}/api/posts/${post_id}/publish")"
record "admin publish (draft only)" "200" "$code"
published_status="$(extract_json '.status // empty' "$resp_json")"
published_at="$(extract_json '.publishedAt // empty' "$resp_json")"
record "published post status is published" "published" "$published_status"
if [[ -z "$published_at" || "$published_at" == "null" ]]; then
  printf 'FAIL expected published post to have publishedAt timestamp\n'
  exit 1
fi
v_published="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v_published" ]]; then
  printf 'FAIL expected published post to have a version\n'
  exit 1
fi

# Verify publish is draft only: publishing already-published post returns 409 not_draft
republish_payload="$(jq -n --arg version "$v_published" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$republish_payload" "${BASE}/api/posts/${post_id}/publish")"
record "admin publish non-draft returns 409 (draft only)" "409" "$code"
not_draft_code="$(extract_json '.code // empty' "$resp_json")"
record "publish non-draft error code is not_draft" "not_draft" "$not_draft_code"

# 8. Edit the published article to create a pending revision
edit_published_payload="$(jq -n \
  --arg version "$v_published" \
  --arg title "Smoke Post Revised Title" \
  --arg summary "Pending revision summary" \
  --arg bodyHtml "<p>Pending revision body content</p>" \
  '{version: $version, title: $title, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$edit_published_payload" "${BASE}/api/posts/${post_id}")"
record "admin edit published article to create pending revision" "200" "$code"
rev_version="$(extract_json '.version // empty' "$resp_json")"
rev_base_version="$(extract_json '.baseVersion // empty' "$resp_json")"
record "pending revision baseVersion matches published version" "$v_published" "$rev_base_version"
if [[ -z "$rev_version" ]]; then
  printf 'FAIL expected pending revision to have a version\n'
  exit 1
fi

# 9. GET /revision
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${post_id}/revision")"
record "admin GET /api/posts/[id]/revision" "200" "$code"
get_rev_title="$(extract_json '.title // empty' "$resp_json")"
get_rev_version="$(extract_json '.version // empty' "$resp_json")"
record "GET /revision title matches pending revision" "Smoke Post Revised Title" "$get_rev_title"
record "GET /revision version matches pending revision" "$rev_version" "$get_rev_version"

# 10. Approve via POST /[id]/revision/publish with the revision version
approve_payload="$(jq -n --arg version "$rev_version" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$approve_payload" "${BASE}/api/posts/${post_id}/revision/publish")"
record "admin approve via POST /[id]/revision/publish with revision version" "200" "$code"
live_after_rev_status="$(extract_json '.status // empty' "$resp_json")"
live_after_rev_title="$(extract_json '.title // empty' "$resp_json")"
live_after_rev_has_pending="$(extract_json '.hasPendingRevision' "$resp_json")"
record "live post status after revision publish is published" "published" "$live_after_rev_status"
record "live post title after revision publish is revised title" "Smoke Post Revised Title" "$live_after_rev_title"
record "live post hasPendingRevision after revision publish is false" "false" "$live_after_rev_has_pending"
v_live_rev="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v_live_rev" ]]; then
  printf 'FAIL expected live post to have a version after revision publish\n'
  exit 1
fi

# 11. Unpublish
unpublish_payload="$(jq -n --arg version "$v_live_rev" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$unpublish_payload" "${BASE}/api/posts/${post_id}/unpublish")"
record "admin unpublish via POST /[id]/unpublish" "200" "$code"
unpublish_status="$(extract_json '.status // empty' "$resp_json")"
record "post status after unpublish is draft" "draft" "$unpublish_status"
v_draft_after_unpublish="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$v_draft_after_unpublish" ]]; then
  printf 'FAIL expected post to have a version after unpublish\n'
  exit 1
fi

# Confirm unpublish on non-published returns 409 not_published per contract v1.2
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$unpublish_payload" "${BASE}/api/posts/${post_id}/unpublish")"
record "admin unpublish draft returns 409 not_published" "409" "$code"
not_published_code="$(extract_json '.code // empty' "$resp_json")"
record "unpublish draft error code is not_published" "not_published" "$not_published_code"

# -----------------------------------------------------------------------------
# 12. Stored XSS check
# -----------------------------------------------------------------------------
xss_slug_suffix="$(date +%s)-$RANDOM"
xss_slug="smoke-xss-${xss_slug_suffix}"
xss_title="Smoke XSS ${xss_slug_suffix}"

xss_create_payload="$(jq -n \
  --arg title "$xss_title" \
  --arg slug "$xss_slug" \
  --arg summary "Stored XSS smoke test draft" \
  --arg tags "xss,smoke" \
  --arg seoTitle "Smoke XSS" \
  --arg seoKeywords "xss,smoke" \
  --arg bodyHtml "<p>Initial clean draft body</p>" \
  '{title: $title, slug: $slug, summary: $summary, tags: $tags, seoTitle: $seoTitle, seoKeywords: $seoKeywords, bodyHtml: $bodyHtml}')"

code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$xss_create_payload" "${BASE}/api/posts")"
record "admin create draft for stored XSS check" "201" "$code"

xss_post_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$xss_post_id" ]]; then
  printf 'FAIL expected created XSS post to return an id\n'
  exit 1
fi

code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${xss_post_id}")"
record "admin GET draft for initial version before XSS save" "200" "$code"
xss_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$xss_v0" ]]; then
  printf 'FAIL expected XSS post to have a version\n'
  exit 1
fi

# Save draft whose body contains XSS payloads
xss_dangerous_body='<p>Safe start</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><button onclick="alert(1)">click</button><p onclick="alert(1)">more</p><svg onload="alert(1)"><circle cx="5" cy="5" r="5"/></svg><p>Safe end</p>'

xss_save_payload="$(jq -n \
  --arg version "$xss_v0" \
  --arg bodyHtml "$xss_dangerous_body" \
  '{version: $version, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$xss_save_payload" "${BASE}/api/posts/${xss_post_id}")"
record "admin save draft with stored XSS payloads" "200" "$code"
xss_v1="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$xss_v1" || "$xss_v1" == "$xss_v0" ]]; then
  printf 'FAIL expected save draft with XSS payloads to return an updated version\n'
  exit 1
fi

# Publish it
xss_publish_payload="$(jq -n --arg version "$xss_v1" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$xss_publish_payload" "${BASE}/api/posts/${xss_post_id}/publish")"
record "admin publish stored XSS post" "200" "$code"

# GET the post and assert none of those dangerous fragments remain in stored/returned HTML
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${xss_post_id}")"
record "admin GET published post for stored XSS check" "200" "$code"

xss_stored_body="$(extract_json '.bodyHtml // empty' "$resp_json")"
if [[ -z "$xss_stored_body" ]]; then
  printf 'FAIL expected published post to contain stored bodyHtml\n'
  exit 1
fi

for frag in "script" "onerror" "onload" "onclick" "javascript:"; do
  if printf '%s' "$xss_stored_body" | grep -qi "$frag"; then
    record "stored XSS dangerous fragment '$frag' absent from response" "absent" "found"
  else
    record "stored XSS dangerous fragment '$frag' absent from response" "absent" "absent"
  fi
done

# -----------------------------------------------------------------------------
# 13. Cross-user isolation
# -----------------------------------------------------------------------------
iso_slug_suffix="$(date +%s)-$RANDOM"
iso_slug="smoke-iso-${iso_slug_suffix}"
iso_title="Smoke Isolation ${iso_slug_suffix}"
iso_summary="Admin post for cross-user isolation testing"
iso_body="<p>Original admin post content that guest must not change.</p>"

iso_create_payload="$(jq -n \
  --arg title "$iso_title" \
  --arg slug "$iso_slug" \
  --arg summary "$iso_summary" \
  --arg bodyHtml "$iso_body" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$iso_create_payload" "${BASE}/api/posts")"
record "admin create post for cross-user isolation" "201" "$code"

iso_post_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$iso_post_id" ]]; then
  printf 'FAIL expected created isolation post to return an id\n'
  exit 1
fi

code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${iso_post_id}")"
record "admin GET isolation post initial state" "200" "$code"
iso_v_before="$(extract_json '.version // empty' "$resp_json")"
iso_status_before="$(extract_json '.status // empty' "$resp_json")"
iso_title_before="$(extract_json '.title // empty' "$resp_json")"
iso_body_before="$(extract_json '.bodyHtml // empty' "$resp_json")"
iso_summary_before="$(extract_json '.summary // empty' "$resp_json")"
if [[ -z "$iso_v_before" ]]; then
  printf 'FAIL expected isolation post to have a version\n'
  exit 1
fi

# Guest tries GET on admin's post -> 404 not_found
code="$(call_api "$resp_json" -b "$guest_jar" "${BASE}/api/posts/${iso_post_id}")"
record "guest GET admin post returns 404" "404" "$code"
guest_get_err="$(extract_json '.code // empty' "$resp_json")"
record "guest GET admin post error code is not_found" "not_found" "$guest_get_err"

# Cross-user 404 indistinguishable from fake ID (byte-for-byte identical raw bodies)
random_uuid=""
if command -v uuidgen >/dev/null 2>&1; then
  random_uuid="$(uuidgen | tr '[:upper:]' '[:lower:]')"
elif [[ -r /proc/sys/kernel/random/uuid ]]; then
  random_uuid="$(cat /proc/sys/kernel/random/uuid)"
else
  random_uuid="$(node -e 'process.stdout.write(crypto.randomUUID())')"
fi

if [[ -z "$random_uuid" ]]; then
  printf 'FAIL unable to generate random UUID\n'
  exit 1
fi

resp_random="${cookie_dir}/resp_random.json"
resp_admin_post="${cookie_dir}/resp_admin_post.json"
cp "$resp_json" "$resp_admin_post"

code_random="$(call_api "$resp_random" -b "$guest_jar" "${BASE}/api/posts/${random_uuid}")"
record "guest GET random uuid returns 404" "404" "$code_random"

raw_random="$(cat "$resp_random")"
raw_admin="$(cat "$resp_admin_post")"

cmp_result="differ"
if [[ "$code" == "404" && "$code_random" == "404" ]] && cmp -s "$resp_random" "$resp_admin_post" && [[ "$raw_random" == "$raw_admin" ]]; then
  cmp_result="identical"
fi
record "guest GET random uuid and admin post response bodies are byte-for-byte identical" "identical" "$cmp_result"

# Guest tries PATCH on admin's post -> 404 not_found
guest_patch_payload="$(jq -n \
  --arg version "$iso_v_before" \
  --arg title "Guest Tampered Title" \
  --arg bodyHtml "<p>Guest tampered body content</p>" \
  '{version: $version, title: $title, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$guest_patch_payload" "${BASE}/api/posts/${iso_post_id}")"
record "guest PATCH admin post returns 404" "404" "$code"
guest_patch_err="$(extract_json '.code // empty' "$resp_json")"
record "guest PATCH admin post error code is not_found" "not_found" "$guest_patch_err"

# Guest tries GET /revision on admin's post -> 404 not_found
code="$(call_api "$resp_json" -b "$guest_jar" "${BASE}/api/posts/${iso_post_id}/revision")"
record "guest GET admin post revision returns 404" "404" "$code"
guest_rev_err="$(extract_json '.code // empty' "$resp_json")"
record "guest GET admin post revision error code is not_found" "not_found" "$guest_rev_err"

# Guest isolation on actions: as guest, POST publish, unpublish, archive and revision/publish on another user's (admin's) post must not return 2xx and must be byte-identical to random UUID (no existence leak)
guest_act_payload="$(jq -n --arg version "$iso_v_before" '{version: $version}')"
resp_act_admin="${cookie_dir}/resp_act_admin.json"
resp_act_random="${cookie_dir}/resp_act_random.json"

for act in "publish" "unpublish" "archive" "revision/publish"; do
  code="$(call_api "$resp_act_admin" -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$guest_act_payload" "${BASE}/api/posts/${iso_post_id}/${act}")"
  status_not_2xx="not-2xx"
  if [[ "$code" == "000" || "$code" =~ ^2 ]]; then
    status_not_2xx="$code"
  fi
  record "guest POST admin post ${act} status is not 2xx" "not-2xx" "$status_not_2xx"

  code_random="$(call_api "$resp_act_random" -b "$guest_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$guest_act_payload" "${BASE}/api/posts/${random_uuid}/${act}")"

  cmp_result="differ"
  if [[ "$code" != "000" && ! "$code" =~ ^2 && "$code" == "$code_random" ]] && cmp -s "$resp_act_admin" "$resp_act_random" && [[ "$(cat "$resp_act_admin")" == "$(cat "$resp_act_random")" ]]; then
    cmp_result="identical"
  fi
  record "guest POST admin post ${act} status and response body are byte-identical to random uuid (no existence leak)" "identical" "$cmp_result"
done

# Assert post is unchanged afterwards
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${iso_post_id}")"
record "admin GET isolation post after guest attempts" "200" "$code"
iso_v_after="$(extract_json '.version // empty' "$resp_json")"
iso_status_after="$(extract_json '.status // empty' "$resp_json")"
iso_title_after="$(extract_json '.title // empty' "$resp_json")"
iso_body_after="$(extract_json '.bodyHtml // empty' "$resp_json")"
iso_summary_after="$(extract_json '.summary // empty' "$resp_json")"

record "isolation post status unchanged after guest attempts" "$iso_status_before" "$iso_status_after"
record "isolation post version unchanged after guest attempts" "$iso_v_before" "$iso_v_after"
record "isolation post title unchanged after guest attempts" "$iso_title_before" "$iso_title_after"
record "isolation post bodyHtml unchanged after guest attempts" "$iso_body_before" "$iso_body_after"
record "isolation post summary unchanged after guest attempts" "$iso_summary_before" "$iso_summary_after"

# -----------------------------------------------------------------------------
# 14. Unpublish semantics: published post with pending revision
# -----------------------------------------------------------------------------
unpub_slug_suffix="$(date +%s)-$RANDOM"
unpub_slug="smoke-unpub-${unpub_slug_suffix}"
unpub_title="Smoke Unpublish ${unpub_slug_suffix}"
unpub_summary="Draft post for unpublish semantics check"
unpub_body="<p>Body content for unpublish semantics check</p>"

unpub_create_payload="$(jq -n \
  --arg title "$unpub_title" \
  --arg slug "$unpub_slug" \
  --arg summary "$unpub_summary" \
  --arg bodyHtml "$unpub_body" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$unpub_create_payload" "${BASE}/api/posts")"
record "admin create post for unpublish check" "201" "$code"

unpub_post_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$unpub_post_id" ]]; then
  printf 'FAIL expected created unpublish post to return an id\n'
  exit 1
fi

code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${unpub_post_id}")"
record "admin GET draft for unpublish check initial version" "200" "$code"
unpub_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$unpub_v0" ]]; then
  printf 'FAIL expected unpublish draft to have a version\n'
  exit 1
fi

# Publish the post
unpub_publish_payload="$(jq -n --arg version "$unpub_v0" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$unpub_publish_payload" "${BASE}/api/posts/${unpub_post_id}/publish")"
record "admin publish post for unpublish check" "200" "$code"
unpub_pub_status="$(extract_json '.status // empty' "$resp_json")"
record "post status before unpublish is published" "published" "$unpub_pub_status"

unpub_published_at_before="$(extract_json '.publishedAt // empty' "$resp_json")"
if [[ -z "$unpub_published_at_before" || "$unpub_published_at_before" == "null" ]]; then
  printf 'FAIL expected published post to have non-null publishedAt\n'
  exit 1
fi
record "published post has non-null publishedAt" "non-null" "non-null"

unpub_v_pub="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$unpub_v_pub" ]]; then
  printf 'FAIL expected published post to have a version\n'
  exit 1
fi

# Edit published post to create a pending revision
unpub_edit_payload="$(jq -n \
  --arg version "$unpub_v_pub" \
  --arg title "${unpub_title} Pending Revision" \
  --arg summary "Pending revision summary before unpublish" \
  --arg bodyHtml "<p>Pending revision body content before unpublish</p>" \
  '{version: $version, title: $title, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$unpub_edit_payload" "${BASE}/api/posts/${unpub_post_id}")"
record "admin edit published post to create pending revision for unpublish check" "200" "$code"

# Verify post currently has pending revision before unpublish
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${unpub_post_id}")"
record "admin GET published post before unpublish" "200" "$code"
unpub_has_pending_before="$(extract_json '.hasPendingRevision' "$resp_json")"
record "post hasPendingRevision is true before unpublish" "true" "$unpub_has_pending_before"

code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${unpub_post_id}/revision")"
record "admin GET /revision before unpublish returns 200" "200" "$code"

# Unpublish
unpublish_op_payload="$(jq -n --arg version "$unpub_v_pub" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$unpublish_op_payload" "${BASE}/api/posts/${unpub_post_id}/unpublish")"
record "admin unpublish published post with pending revision" "200" "$code"

unpub_status_after="$(extract_json '.status // empty' "$resp_json")"
record "post status after unpublish is draft" "draft" "$unpub_status_after"

# Assert publishedAt is kept (unchanged, non-null)
unpub_published_at_after="$(extract_json '.publishedAt // empty' "$resp_json")"
if [[ -z "$unpub_published_at_after" || "$unpub_published_at_after" == "null" ]]; then
  printf 'FAIL expected publishedAt to remain non-null after unpublish\n'
  exit 1
fi
record "unpublish keeps publishedAt non-null" "non-null" "non-null"
record "unpublish keeps publishedAt unchanged" "$unpub_published_at_before" "$unpub_published_at_after"

# Assert pending revision is set aside (hasPendingRevision false)
unpub_has_pending_after="$(extract_json '.hasPendingRevision' "$resp_json")"
record "unpublish sets aside pending revision (hasPendingRevision is false)" "false" "$unpub_has_pending_after"

# Confirm with GET /api/posts/[id]
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${unpub_post_id}")"
record "admin GET post after unpublish" "200" "$code"
get_unpub_status="$(extract_json '.status // empty' "$resp_json")"
get_unpub_published_at="$(extract_json '.publishedAt // empty' "$resp_json")"
get_unpub_has_pending="$(extract_json '.hasPendingRevision' "$resp_json")"
record "GET post status after unpublish is draft" "draft" "$get_unpub_status"
record "GET post publishedAt after unpublish is unchanged" "$unpub_published_at_before" "$get_unpub_published_at"
record "GET post hasPendingRevision after unpublish is false" "false" "$get_unpub_has_pending"

# Assert GET /revision returns 404 per contract docs
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${unpub_post_id}/revision")"
record "admin GET /revision after unpublish returns 404" "404" "$code"
unpub_rev_err="$(extract_json '.code // empty' "$resp_json")"
record "admin GET /revision after unpublish error code is not_found" "not_found" "$unpub_rev_err"

# -----------------------------------------------------------------------------
# 15. Contract v1.2.1 checks
# -----------------------------------------------------------------------------

# (1) POST /api/posts response includes a non-empty version, and that version works directly for the first PATCH without a GET
c121_slug_suffix="$(date +%s)-$RANDOM"
c121_slug="smoke-v121-${c121_slug_suffix}"
c121_title="Smoke v121 ${c121_slug_suffix}"
c121_summary="Contract v1.2.1 initial summary"
c121_body="<p>Initial contract v1.2.1 draft body content</p>"

c121_create_payload="$(jq -n \
  --arg title "$c121_title" \
  --arg slug "$c121_slug" \
  --arg summary "$c121_summary" \
  --arg tags "contract,v121" \
  --arg seoTitle "Contract v1.2.1 SEO" \
  --arg seoKeywords "v121,contract" \
  --arg bodyHtml "$c121_body" \
  '{title: $title, slug: $slug, summary: $summary, tags: $tags, seoTitle: $seoTitle, seoKeywords: $seoKeywords, bodyHtml: $bodyHtml}')"

code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$c121_create_payload" "${BASE}/api/posts")"
record "admin POST /api/posts (contract v1.2.1)" "201" "$code"

c121_post_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$c121_post_id" ]]; then
  printf 'FAIL expected contract v1.2.1 created post to return an id\n'
  exit 1
fi

c121_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$c121_v0" ]]; then
  printf 'FAIL expected contract v1.2.1 POST /api/posts to return a version\n'
  exit 1
fi
record "POST /api/posts response includes non-empty version" "non-empty" "$([ -n "$c121_v0" ] && echo "non-empty" || echo "empty")"

# First PATCH directly using c121_v0 without calling GET
c121_first_patch_payload="$(jq -n \
  --arg version "$c121_v0" \
  --arg summary "Direct patch summary without GET" \
  --arg bodyHtml "<p>Directly patched body without GET</p>" \
  '{version: $version, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$c121_first_patch_payload" "${BASE}/api/posts/${c121_post_id}")"
record "first PATCH using create version without GET returns 200" "200" "$code"

c121_v1="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$c121_v1" || "$c121_v1" == "$c121_v0" ]]; then
  printf 'FAIL expected first PATCH to return an updated version\n'
  exit 1
fi

# (2) admin POST /api/posts with status:published still creates a draft (GET shows status draft)
pub_attempt_slug_suffix="$(date +%s)-$RANDOM"
pub_attempt_slug="smoke-v121-pubdraft-${pub_attempt_slug_suffix}"
pub_attempt_title="Smoke v121 PubDraft ${pub_attempt_slug_suffix}"
pub_attempt_summary="Draft created with status:published"
pub_attempt_body="<p>Body for status:published create attempt</p>"

pub_attempt_payload="$(jq -n \
  --arg title "$pub_attempt_title" \
  --arg slug "$pub_attempt_slug" \
  --arg summary "$pub_attempt_summary" \
  --arg bodyHtml "$pub_attempt_body" \
  --arg status "published" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml, status: $status}')"

code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$pub_attempt_payload" "${BASE}/api/posts")"
record "admin POST /api/posts with status:published returns 201" "201" "$code"

pub_attempt_id="$(extract_json '.id // empty' "$resp_json")"
if [[ -z "$pub_attempt_id" ]]; then
  printf 'FAIL expected status:published create attempt to return an id\n'
  exit 1
fi

code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${pub_attempt_id}")"
record "admin GET /api/posts/[id] after status:published create returns 200" "200" "$code"

pub_attempt_status="$(extract_json '.status // empty' "$resp_json")"
record "admin POST with status:published creates draft (GET shows status draft)" "draft" "$pub_attempt_status"

# (3) Stale-version PATCH returns 409 stale_version and response body includes current version,
# and retrying PATCH with that version succeeds;
# for a published post with a pending revision, the 409 version equals the pending revision's version.

# 3a. Draft post stale-version PATCH
stale_draft_payload="$(jq -n \
  --arg version "$c121_v0" \
  --arg title "Stale draft edit should fail" \
  '{version: $version, title: $title}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$stale_draft_payload" "${BASE}/api/posts/${c121_post_id}")"
record "draft stale-version PATCH returns 409" "409" "$code"

stale_draft_code="$(extract_json '.code // empty' "$resp_json")"
record "draft stale-version error code is stale_version" "stale_version" "$stale_draft_code"

stale_draft_resp_version="$(extract_json '.version // empty' "$resp_json")"
record "draft stale-version 409 response body includes current version" "$c121_v1" "$stale_draft_resp_version"

# Retrying the draft PATCH with the version from 409 succeeds
retry_draft_payload="$(jq -n \
  --arg version "$stale_draft_resp_version" \
  --arg title "${c121_title} Retried" \
  '{version: $version, title: $title}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$retry_draft_payload" "${BASE}/api/posts/${c121_post_id}")"
record "retrying draft PATCH with version from 409 succeeds" "200" "$code"

c121_v2="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$c121_v2" || "$c121_v2" == "$stale_draft_resp_version" ]]; then
  printf 'FAIL expected retried draft PATCH to return an updated version\n'
  exit 1
fi

# 3b. Published post with pending revision
rev_stale_slug_suffix="$(date +%s)-$RANDOM"
rev_stale_slug="smoke-v121-revstale-${rev_stale_slug_suffix}"
rev_stale_title="Smoke v121 RevStale ${rev_stale_slug_suffix}"
rev_stale_summary="Published post for revision stale check"
rev_stale_body="<p>Body for revision stale check</p>"

rev_stale_create_payload="$(jq -n \
  --arg title "$rev_stale_title" \
  --arg slug "$rev_stale_slug" \
  --arg summary "$rev_stale_summary" \
  --arg bodyHtml "$rev_stale_body" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$rev_stale_create_payload" "${BASE}/api/posts")"
record "admin create post for pending revision stale check" "201" "$code"

rev_stale_post_id="$(extract_json '.id // empty' "$resp_json")"
rev_stale_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$rev_stale_post_id" || -z "$rev_stale_v0" ]]; then
  printf 'FAIL expected created post to return id and version\n'
  exit 1
fi

# Publish the post
rev_stale_pub_payload="$(jq -n --arg version "$rev_stale_v0" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$rev_stale_pub_payload" "${BASE}/api/posts/${rev_stale_post_id}/publish")"
record "admin publish post for pending revision stale check" "200" "$code"
rev_stale_live_version="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$rev_stale_live_version" ]]; then
  printf 'FAIL expected published post to have a version\n'
  exit 1
fi

# Create a pending revision by PATCHing the published post
rev_stale_edit_payload="$(jq -n \
  --arg version "$rev_stale_live_version" \
  --arg title "${rev_stale_title} Pending Revision" \
  --arg summary "Pending revision summary" \
  --arg bodyHtml "<p>Pending revision body content</p>" \
  '{version: $version, title: $title, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$rev_stale_edit_payload" "${BASE}/api/posts/${rev_stale_post_id}")"
record "admin create pending revision on published post" "200" "$code"

pending_rev_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$pending_rev_v0" ]]; then
  printf 'FAIL expected pending revision to have a version\n'
  exit 1
fi

# Confirm pending revision version via GET /revision
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${rev_stale_post_id}/revision")"
record "admin GET /revision before stale PATCH returns 200" "200" "$code"
get_pending_rev_v0="$(extract_json '.version // empty' "$resp_json")"
record "GET /revision version matches pending revision version" "$pending_rev_v0" "$get_pending_rev_v0"

# Send PATCH with stale version (e.g. rev_stale_live_version, which is superseded by pending revision)
rev_stale_bad_patch="$(jq -n \
  --arg version "$rev_stale_live_version" \
  --arg title "${rev_stale_title} Stale Revision Edit" \
  '{version: $version, title: $title}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$rev_stale_bad_patch" "${BASE}/api/posts/${rev_stale_post_id}")"
record "stale-version PATCH on published post with pending revision returns 409" "409" "$code"

rev_stale_err_code="$(extract_json '.code // empty' "$resp_json")"
record "stale-version error code on published post with revision is stale_version" "stale_version" "$rev_stale_err_code"

# Crucial contract v1.2.1 check:
# for a published post with a pending revision, the 409 version equals the pending revision's version
rev_stale_resp_version="$(extract_json '.version // empty' "$resp_json")"
record "published post with pending revision 409 version equals pending revision version" "$pending_rev_v0" "$rev_stale_resp_version"

# Retrying the PATCH with that version succeeds
retry_rev_patch_payload="$(jq -n \
  --arg version "$rev_stale_resp_version" \
  --arg title "${rev_stale_title} Revision Retried" \
  --arg summary "Updated pending revision summary after retry" \
  '{version: $version, title: $title, summary: $summary}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$retry_rev_patch_payload" "${BASE}/api/posts/${rev_stale_post_id}")"
record "retrying revision PATCH with 409 version succeeds" "200" "$code"

pending_rev_v1="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$pending_rev_v1" || "$pending_rev_v1" == "$rev_stale_resp_version" ]]; then
  printf 'FAIL expected retried revision PATCH to return an updated version\n'
  exit 1
fi

# Verify via GET /revision that retry succeeded and updated the pending revision
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${rev_stale_post_id}/revision")"
record "admin GET /revision after retried revision PATCH returns 200" "200" "$code"
get_retry_rev_title="$(extract_json '.title // empty' "$resp_json")"
get_retry_rev_summary="$(extract_json '.summary // empty' "$resp_json")"
get_retry_rev_version="$(extract_json '.version // empty' "$resp_json")"
record "retried revision title matches" "${rev_stale_title} Revision Retried" "$get_retry_rev_title"
record "retried revision summary matches" "Updated pending revision summary after retry" "$get_retry_rev_summary"
record "retried revision version matches GET /revision" "$pending_rev_v1" "$get_retry_rev_version"

# -----------------------------------------------------------------------------
# 16. Stored XSS via pending-revision approval path
# -----------------------------------------------------------------------------
rev_xss_slug_suffix="$(date +%s)-$RANDOM"
rev_xss_slug="smoke-rev-xss-${rev_xss_slug_suffix}"
rev_xss_title="Smoke Revision XSS ${rev_xss_slug_suffix}"

rev_xss_create_payload="$(jq -n \
  --arg title "$rev_xss_title" \
  --arg slug "$rev_xss_slug" \
  --arg summary "Initial clean draft for pending-revision XSS check" \
  --arg bodyHtml "<p>Initial clean draft body</p>" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$rev_xss_create_payload" "${BASE}/api/posts")"
record "admin create draft for pending-revision stored XSS check" "201" "$code"

rev_xss_post_id="$(extract_json '.id // empty' "$resp_json")"
rev_xss_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$rev_xss_post_id" || -z "$rev_xss_v0" ]]; then
  printf 'FAIL expected created pending-revision XSS post to return id and version\n'
  exit 1
fi

# Publish the post
rev_xss_pub_payload="$(jq -n --arg version "$rev_xss_v0" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$rev_xss_pub_payload" "${BASE}/api/posts/${rev_xss_post_id}/publish")"
record "admin publish post for pending-revision stored XSS check" "200" "$code"

rev_xss_v_pub="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$rev_xss_v_pub" ]]; then
  printf 'FAIL expected published post to have a version\n'
  exit 1
fi

# Edit it with an XSS payload to create a pending revision
rev_xss_dangerous_body='<p>Safe start</p><script>alert(1)</script><img src="https://example.com/test.png" onerror="alert(1)"><a href="javascript:alert(1)">click</a><p>Safe end</p>'

rev_xss_edit_payload="$(jq -n \
  --arg version "$rev_xss_v_pub" \
  --arg title "${rev_xss_title} Pending Revision" \
  --arg summary "Pending revision with XSS" \
  --arg bodyHtml "$rev_xss_dangerous_body" \
  '{version: $version, title: $title, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$rev_xss_edit_payload" "${BASE}/api/posts/${rev_xss_post_id}")"
record "admin edit published post with XSS to create pending revision" "200" "$code"

rev_xss_rev_version="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$rev_xss_rev_version" ]]; then
  printf 'FAIL expected pending revision to have a version\n'
  exit 1
fi

# Approve revision via POST /api/posts/[id]/revision/publish as admin
rev_xss_approve_payload="$(jq -n --arg version "$rev_xss_rev_version" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$rev_xss_approve_payload" "${BASE}/api/posts/${rev_xss_post_id}/revision/publish")"
record "admin approve pending revision with XSS via POST /api/posts/[id]/revision/publish" "200" "$code"

# GET live post and assert live bodyHtml contains no script/onerror/javascript: fragments
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${rev_xss_post_id}")"
record "admin GET live post after revision approval for stored XSS check" "200" "$code"

rev_xss_live_body="$(extract_json '.bodyHtml // empty' "$resp_json")"
if [[ -z "$rev_xss_live_body" ]]; then
  printf 'FAIL expected live post to contain bodyHtml\n'
  exit 1
fi

for frag in "script" "onerror" "javascript:"; do
  if printf '%s' "$rev_xss_live_body" | grep -qi "$frag"; then
    record "pending-revision XSS dangerous fragment '$frag' absent from live bodyHtml" "absent" "found"
  else
    record "pending-revision XSS dangerous fragment '$frag' absent from live bodyHtml" "absent" "absent"
  fi
done

# -----------------------------------------------------------------------------
# 17. Safe content survives sanitizing
# -----------------------------------------------------------------------------
safe_slug_suffix="$(date +%s)-$RANDOM"
safe_slug="smoke-safe-${safe_slug_suffix}"
safe_title="Smoke Safe Content ${safe_slug_suffix}"
safe_body='<p>Safe paragraph with <strong>bold text</strong>, <a href="https://example.com">example link</a>, and <img src="https://example.com/test.png" alt="safe image" />.</p>'

safe_create_payload="$(jq -n \
  --arg title "$safe_title" \
  --arg slug "$safe_slug" \
  --arg summary "Draft with benign markup" \
  --arg bodyHtml "$safe_body" \
  '{title: $title, slug: $slug, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$safe_create_payload" "${BASE}/api/posts")"
record "admin create draft with benign markup" "201" "$code"

safe_post_id="$(extract_json '.id // empty' "$resp_json")"
safe_v0="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$safe_post_id" || -z "$safe_v0" ]]; then
  printf 'FAIL expected created safe content post to return id and version\n'
  exit 1
fi

# Save draft (PATCH) with benign markup
safe_save_payload="$(jq -n \
  --arg version "$safe_v0" \
  --arg summary "Saved draft with benign markup" \
  --arg bodyHtml "$safe_body" \
  '{version: $version, summary: $summary, bodyHtml: $bodyHtml}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X PATCH --data-binary "$safe_save_payload" "${BASE}/api/posts/${safe_post_id}")"
record "admin save draft with benign markup" "200" "$code"

safe_v1="$(extract_json '.version // empty' "$resp_json")"
if [[ -z "$safe_v1" || "$safe_v1" == "$safe_v0" ]]; then
  printf 'FAIL expected save draft with benign markup to return updated version\n'
  exit 1
fi

# GET draft and assert benign markup is present in bodyHtml after save
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${safe_post_id}")"
record "admin GET draft after save for benign markup check" "200" "$code"
safe_saved_body="$(extract_json '.bodyHtml // empty' "$resp_json")"
if [[ -z "$safe_saved_body" ]]; then
  printf 'FAIL expected draft to contain bodyHtml after save\n'
  exit 1
fi

for frag in "<p>" "<strong>" "href=\"https://example.com\"" "<img" "src=\"https://example.com"; do
  if printf '%s' "$safe_saved_body" | grep -qiF "$frag"; then
    record "benign markup fragment '$frag' present in bodyHtml after save" "present" "present"
  else
    record "benign markup fragment '$frag' present in bodyHtml after save" "present" "absent"
  fi
done

# Publish the post
safe_pub_payload="$(jq -n --arg version "$safe_v1" '{version: $version}')"
code="$(call_api "$resp_json" -b "$admin_jar" -H "Origin: ${BASE}" -H "Content-Type: application/json" -X POST --data-binary "$safe_pub_payload" "${BASE}/api/posts/${safe_post_id}/publish")"
record "admin publish post with benign markup" "200" "$code"

# GET published post and assert benign markup is present in bodyHtml after publish
code="$(call_api "$resp_json" -b "$admin_jar" "${BASE}/api/posts/${safe_post_id}")"
record "admin GET published post for benign markup check" "200" "$code"
safe_pub_body="$(extract_json '.bodyHtml // empty' "$resp_json")"
if [[ -z "$safe_pub_body" ]]; then
  printf 'FAIL expected published post to contain bodyHtml after publish\n'
  exit 1
fi

for frag in "<p>" "<strong>" "href=\"https://example.com\"" "<img" "src=\"https://example.com"; do
  if printf '%s' "$safe_pub_body" | grep -qiF "$frag"; then
    record "benign markup fragment '$frag' present in bodyHtml after publish" "present" "present"
  else
    record "benign markup fragment '$frag' present in bodyHtml after publish" "present" "absent"
  fi
done

exit "$failed"
