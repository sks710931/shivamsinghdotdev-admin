#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="${SCRIPT_DIR}/smoke-api.sh"

if [[ ! -f "$SMOKE_SCRIPT" ]]; then
  echo "FAIL: smoke-api.sh not found at $SMOKE_SCRIPT" >&2
  exit 1
fi

# Shadow curl with a dummy executable that fails if called,
# guaranteeing no HTTP/network requests are made during testing.
fake_bin="$(mktemp -d)"
trap 'rm -rf "$fake_bin"' EXIT
cat > "${fake_bin}/curl" << 'EOF'
#!/usr/bin/env bash
echo "ERROR: curl was invoked when no HTTP requests were expected!" >&2
exit 99
EOF
chmod +x "${fake_bin}/curl"
export PATH="${fake_bin}:${PATH}"

run_case() {
  local desc="$1"
  local expected_exit="$2" # expected numerical exit code: 0 or 2
  local app_url="$3"
  shift 3

  local start_time end_time duration exit_code output
  start_time=$(date +%s)
  exit_code=0
  output="$(APP_URL="$app_url" bash "$SMOKE_SCRIPT" "$@" 2>&1)" || exit_code=$?
  end_time=$(date +%s)
  duration=$((end_time - start_time))

  # Assert fast execution (< 3 seconds)
  if (( duration >= 3 )); then
    echo "FAIL: $desc took too long (${duration}s >= 3s)" >&2
    exit 1
  fi

  # Assert no HTTP requests made
  if [[ "$output" == *"ERROR: curl was invoked"* ]]; then
    echo "FAIL: $desc made HTTP requests!" >&2
    exit 1
  fi

  # Assert exit code matches expected
  if (( exit_code != expected_exit )); then
    echo "FAIL: $desc expected exit code $expected_exit, got $exit_code" >&2
    echo "Output: $output" >&2
    exit 1
  fi

  echo "PASS: $desc (exit $exit_code in ${duration}s)"
}

echo "Running smoke-api host guard tests..."

# 1. APP_URL=http://localhost.evil.com asserts exit non-zero (exit 2) quickly without making requests
run_case "http://localhost.evil.com rejected (full script)" 2 "http://localhost.evil.com"
run_case "http://localhost.evil.com rejected (--check-host-only)" 2 "http://localhost.evil.com" --check-host-only

# 2. APP_URL=http://localhost@evil.com asserts exit non-zero (exit 2) quickly without making requests
run_case "http://localhost@evil.com rejected (full script)" 2 "http://localhost@evil.com"
run_case "http://localhost@evil.com rejected (--check-host-only)" 2 "http://localhost@evil.com" --check-host-only

# 3. APP_URL=http://localhost:3000 passes the guard without running requests
run_case "http://localhost:3000 passes guard (--check-host-only)" 0 "http://localhost:3000" --check-host-only

# Additional edge cases
run_case "http://127.0.0.1:3000 passes guard" 0 "http://127.0.0.1:3000" --check-host-only
run_case "http://[::1]:3000 passes guard" 0 "http://[::1]:3000" --check-host-only
run_case "http://localhost passes guard (no port)" 0 "http://localhost" --check-host-only
run_case "https://localhost:3000 passes guard" 0 "https://localhost:3000" --check-host-only

run_case "userinfo rejected (http://user:pass@localhost:3000)" 2 "http://user:pass@localhost:3000" --check-host-only
run_case "untrusted ip rejected (http://127.0.0.2:3000)" 2 "http://127.0.0.2:3000" --check-host-only
run_case "external host rejected (http://evil.com)" 2 "http://evil.com" --check-host-only
run_case "unsupported scheme rejected (ftp://localhost:3000)" 2 "ftp://localhost:3000" --check-host-only

echo "All smoke host guard tests passed."
