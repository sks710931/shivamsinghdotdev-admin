#!/usr/bin/env bash
set -euo pipefail

BASE=${APP_URL:-http://localhost:3000}
BASE=${BASE%/}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ROOT}/.env.local"

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
  fi
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

exit "$failed"
