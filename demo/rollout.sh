#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE=marketplace
DEPLOYMENT=marketplace-api
URL="${ROLLOUT_URL:-http://127.0.0.1:30080/products}"
MIN_REQUESTS="${ROLLOUT_MIN_REQUESTS:-5000}"
TARGET_REQUESTS="${ROLLOUT_TARGET_REQUESTS:-6000}"
export LOAD_RATE="${LOAD_RATE:-100}"

WORK="$(mktemp -d)"
LOAD_PID=""
cleanup() {
    [ -n "$LOAD_PID" ] && kill -TERM "$LOAD_PID" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

kubectl -n "$NAMESPACE" rollout status "deploy/$DEPLOYMENT" --timeout=180s >/dev/null

node "$ROOT/scripts/load.mjs" "$URL" "$WORK/codes.txt" &
LOAD_PID=$!
sleep 3

started=$(date +%s)
bash "$ROOT/scripts/pulumi.sh" up --config rev="$(date +%s)" > "$WORK/up.log" 2>&1 || { cat "$WORK/up.log" >&2; exit 1; }
kubectl -n "$NAMESPACE" rollout status "deploy/$DEPLOYMENT" --timeout=300s >/dev/null
finished=$(date +%s)
sleep 3
until [ "$(wc -l < "$WORK/codes.txt")" -ge "$TARGET_REQUESTS" ]; do sleep 1; done

kill -TERM "$LOAD_PID"
wait "$LOAD_PID" || true
LOAD_PID=""

requests=$(wc -l < "$WORK/codes.txt" | tr -d ' ')
ok=$(grep -cx '200' "$WORK/codes.txt" || true)
failed=$((requests - ok))

echo "profile=hardened"
echo "load-rate=$LOAD_RATE"
echo "requests=$requests"
echo "ok=$ok"
echo "failed=$failed"
echo "rollout-seconds=$((finished - started))"

[ "$failed" -eq 0 ] && [ "$requests" -ge "$MIN_REQUESTS" ]
