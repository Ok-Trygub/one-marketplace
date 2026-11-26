#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNG="${1:?usage: gate.sh types|contract|arch|scan}"
DIR="${GATE_DIR:-$ROOT}"
BIN="$ROOT/node_modules/.bin"
OASDIFF_IMAGE=tufin/oasdiff:v1.35.0

case "$RUNG" in
    types)
        (cd "$DIR" && "$BIN/tsc" --noEmit -p tsconfig.json && "$BIN/eslint" src test)
        ;;
    contract)
        base="${BASE_SPEC:?BASE_SPEC is required: the spec that consumers already use}"
        revision="${REVISION_SPEC:-$DIR/openapi/openapi.yaml}"
        docker run --rm \
            -v "$(cd "$(dirname "$base")" && pwd)/$(basename "$base"):/specs/base.yaml:ro" \
            -v "$(cd "$(dirname "$revision")" && pwd)/$(basename "$revision"):/specs/revision.yaml:ro" \
            "$OASDIFF_IMAGE" breaking /specs/base.yaml /specs/revision.yaml --fail-on ERR
        ;;
    arch)
        (cd "$DIR" && "$BIN/depcruise" src --config .dependency-cruiser.cjs)
        ;;
    scan)
        bash "$ROOT/scripts/scan.sh"
        ;;
    *)
        echo "unknown rung: $RUNG" >&2
        exit 2
        ;;
esac
code=$?

echo "gate-$RUNG-exit=$code"
exit "$code"
