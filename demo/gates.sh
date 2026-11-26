#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-one-marketplace-api:hw28}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

copy_project() {
    local target="$WORK/$1"
    mkdir -p "$target"
    cp -R "$ROOT/src" "$ROOT/test" "$ROOT/openapi" "$ROOT/tsconfig.json" "$ROOT/eslint.config.mjs" "$ROOT/.dependency-cruiser.cjs" "$ROOT/package.json" "$target/"
    ln -s "$ROOT/node_modules" "$target/node_modules"
    echo "$target"
}

replace_once() {
    local file="$1" from="$2" to="$3"
    FROM="$from" TO="$to" perl -0pi -e '$n = () = /\Q$ENV{FROM}\E/g; die "expected exactly one match, found $n\n" unless $n == 1; s/\Q$ENV{FROM}\E/$ENV{TO}/' "$file" || exit 1
}

run_gate() {
    local key="$1"; shift
    "$@" > "$WORK/$key.log" 2>&1
    echo "$key=$?"
}

typo="$(copy_project types)"
replace_once "$typo/src/observability/route.ts" 'request.route?.path' 'request.rout?.path'

breaking_spec="$WORK/openapi-breaking.yaml"
cp "$ROOT/openapi/openapi.yaml" "$breaking_spec"
replace_once "$breaking_spec" $'\n  /products:\n' $'\n  /catalogue:\n'

layering="$(copy_project arch)"
printf "\nimport '../controllers/products.controller'\n" >> "$layering/src/repositories/products.repository.ts"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'demo-placeholder-token' > "$WORK/npm_token"
    docker build -q -f "$ROOT/docker/Dockerfile" --secret "id=npm_token,src=$WORK/npm_token" -t "$IMAGE" "$ROOT" > "$WORK/image-build.log" 2>&1 \
        || { cat "$WORK/image-build.log" >&2; exit 1; }
fi

run_gate types-ok bash "$ROOT/scripts/gate.sh" types
GATE_DIR="$typo" run_gate types-broken bash "$ROOT/scripts/gate.sh" types

BASE_SPEC="$ROOT/openapi/openapi.yaml" run_gate contract-ok bash "$ROOT/scripts/gate.sh" contract
BASE_SPEC="$ROOT/openapi/openapi.yaml" REVISION_SPEC="$breaking_spec" run_gate contract-broken bash "$ROOT/scripts/gate.sh" contract

run_gate arch-ok bash "$ROOT/scripts/gate.sh" arch
GATE_DIR="$layering" run_gate arch-broken bash "$ROOT/scripts/gate.sh" arch

IMAGE="$IMAGE" SCAN_MAX=99999 run_gate scan-ok bash "$ROOT/scripts/gate.sh" scan
IMAGE="$IMAGE" SCAN_MAX=-1 run_gate scan-broken bash "$ROOT/scripts/gate.sh" scan
