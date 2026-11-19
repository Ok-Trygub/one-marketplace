#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=marketplace
DEPLOYMENT=marketplace-api
PDB=marketplace-api

WORK="$(mktemp -d)"
PROXY_PID=""
cleanup() {
    if [ -n "$PROXY_PID" ]; then
        kill "$PROXY_PID" 2>/dev/null || true
        wait "$PROXY_PID" 2>/dev/null || true
    fi
    rm -rf "$WORK"
}
trap cleanup EXIT

wait_disruption_allowed() {
    for _ in $(seq 1 180); do
        [ "$(kubectl -n "$NAMESPACE" get pdb "$PDB" -o jsonpath='{.status.disruptionsAllowed}')" -ge 1 ] && return 0
        sleep 1
    done

    echo "pdb $PDB did not allow a disruption within 180 s" >&2
    return 1
}

kubectl -n "$NAMESPACE" rollout status "deploy/$DEPLOYMENT" --timeout=180s >/dev/null
wait_disruption_allowed

healthy=$(kubectl -n "$NAMESPACE" get pdb "$PDB" -o jsonpath='{.status.currentHealthy}')
min_available=$(kubectl -n "$NAMESPACE" get pdb "$PDB" -o jsonpath='{.spec.minAvailable}')
read -r -a pods <<< "$(kubectl -n "$NAMESPACE" get pods -l app=marketplace-api --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}')"

kubectl proxy --port=0 > "$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
for _ in $(seq 1 50); do
    port=$(sed -nE 's/.*127\.0\.0\.1:([0-9]+).*/\1/p' "$WORK/proxy.log")
    [ -n "$port" ] && break
    sleep 0.1
done

evict() {
    curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        "http://127.0.0.1:$port/api/v1/namespaces/$NAMESPACE/pods/$1/eviction" \
        -d "{\"apiVersion\":\"policy/v1\",\"kind\":\"Eviction\",\"metadata\":{\"name\":\"$1\",\"namespace\":\"$NAMESPACE\"}}"
}

evict_1=$(evict "${pods[0]}")
evict_2=$(evict "${pods[1]}")

echo "healthy=$healthy"
echo "minAvailable=$min_available"
echo "evict-1=$evict_1"
echo "evict-2=$evict_2"

wait_disruption_allowed

[ "$evict_1" = "201" ] && [ "$evict_2" = "429" ]
