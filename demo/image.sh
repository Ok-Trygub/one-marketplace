#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-one-marketplace-api:hw28}"
TOKEN_FILE="$ROOT/.npm_token"

[ -s "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE with the build secret" >&2; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

stages=$(grep -cE '^[[:space:]]*FROM[[:space:]]' "$ROOT/docker/Dockerfile")

if docker run --rm --entrypoint sh "$IMAGE" -c 'exit 0' >/dev/null 2>&1; then shell_inside=1; else shell_inside=0; fi

runtime_uid=$(docker run --rm "$IMAGE" -e 'process.stdout.write(String(process.getuid()))')

in_history=$(docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGE" | grep -cF -- "$TOKEN" || true)
in_config=$(docker image inspect "$IMAGE" | grep -cF -- "$TOKEN" || true)

docker save "$IMAGE" -o "$WORK/image.tar"
tar -xf "$WORK/image.tar" -C "$WORK"
in_layers=0
for layer in $(node -e 'const m=require(process.argv[1]);console.log(m[0].Layers.join("\n"))' "$WORK/manifest.json"); do
    if [ "$(head -c2 "$WORK/$layer" | xxd -p)" = "1f8b" ]; then
        found=$(gzip -dc "$WORK/$layer" | grep -caF -- "$TOKEN" || true)
    else
        found=$(grep -caF -- "$TOKEN" "$WORK/$layer" || true)
    fi
    [ "$found" -gt 0 ] && in_layers=$((in_layers + 1))
done

echo "stages=$stages"
echo "shell-inside=$shell_inside"
echo "runtime-uid=$runtime_uid"
echo "token-in-history=$in_history"
echo "token-in-config=$in_config"
echo "token-in-layers=$in_layers"

[ "$stages" -ge 2 ] && [ "$shell_inside" -eq 0 ] && [ -n "$runtime_uid" ] && [ "$runtime_uid" != "0" ] \
    && [ "$in_history" -eq 0 ] && [ "$in_config" -eq 0 ] && [ "$in_layers" -eq 0 ]
