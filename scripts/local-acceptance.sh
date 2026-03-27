#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3010}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/altselfs-dev-${PORT}.log"

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "[1/6] Lint..."
npm run lint >/dev/null

echo "[2/6] Build..."
npm run build >/dev/null

echo "[3/6] Sync DB schema..."
npx prisma db push >/dev/null

echo "[4/6] Start dev server on 127.0.0.1:${PORT}..."
env -u all_proxy -u ALL_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  NO_PROXY=127.0.0.1,localhost,::1 \
  npm run dev -- --webpack --hostname 127.0.0.1 --port "$PORT" >"$LOG_FILE" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 40); do
  if curl --noproxy '*' -sS -o /dev/null "http://127.0.0.1:${PORT}/"; then
    break
  fi
  sleep 0.5
done

if ! curl --noproxy '*' -sS -o /dev/null "http://127.0.0.1:${PORT}/"; then
  echo "[FAIL] Dev server did not become ready. Last log lines:"
  tail -n 80 "$LOG_FILE"
  exit 1
fi

echo "[5/6] Route/API smoke checks..."

check_not_500() {
  local path="$1"
  local code
  code=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${path}")
  if [[ "$code" == "500" ]]; then
    echo "[FAIL] ${path} returned 500"
    tail -n 80 "$LOG_FILE"
    exit 1
  fi
  echo "  - ${path} => ${code}"
}

check_not_500 "/"
check_not_500 "/dashboard"
check_not_500 "/investor"
check_not_500 "/candidate"
check_not_500 "/api/avatar"
check_not_500 "/api/chat?avatarId=test"

echo "[6/6] Result"
echo "[PASS] Local automated acceptance passed on port ${PORT}."
echo "If you need business-flow validation, run the manual checklist in docs/local-uat.md"
