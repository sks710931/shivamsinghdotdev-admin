#!/usr/bin/env bash
set -euo pipefail

BASE=${APP_URL:-http://localhost:3000}
BASE=${BASE%/}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-${ROOT}/.env.local}"

read_env() {
  local key="$1"
  local line trimmed keypart raw value first lastc
  local found=0
  local last=""

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

record() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS %s\n' "$label"
  else
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
record "guest GET /api/posts/00000000-0000-0000-0000-000000000000" "404" \
  "$(http_code -b "$guest_jar" "${BASE}/api/posts/00000000-0000-0000-0000-000000000000")"

other_post_id=""
if other_post_id="$(read_env TEST_OTHER_POST_ID)" && [[ -n "$other_post_id" ]]; then
  record "guest GET /api/posts/${other_post_id}" "404" \
    "$(http_code -b "$guest_jar" "${BASE}/api/posts/${other_post_id}")"
  record "admin GET /api/posts/${other_post_id}" "200" \
    "$(http_code -b "$admin_jar" "${BASE}/api/posts/${other_post_id}")"
  record "guest GET /api/posts/${other_post_id}/revision" "404" \
    "$(http_code -b "$guest_jar" "${BASE}/api/posts/${other_post_id}/revision")"
  # A draft has no pending revision, so admin sees the post but not a revision.
  record "admin GET /api/posts/${other_post_id}/revision" "404" \
    "$(http_code -b "$admin_jar" "${BASE}/api/posts/${other_post_id}/revision")"
  record "unauthenticated GET /api/posts/${other_post_id}" "401" \
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

exit "$failed"
