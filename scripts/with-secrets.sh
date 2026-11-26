#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"
if [ -f "$CREDS" ]; then
    set -a
    . "$CREDS"
    set +a
fi

cd "$ROOT"

if [ -n "${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-}" ] && [ -n "${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-}" ] && [ -z "${INFISICAL_TOKEN:-}" ]; then
    INFISICAL_TOKEN="$(infisical login --method=universal-auth --client-id="$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" --client-secret="$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" --silent --plain)"
    export INFISICAL_TOKEN
fi

if [ -n "${INFISICAL_TOKEN:-}" ]; then
    exec infisical run --env="$ENV_SLUG" --projectId="$(node -p "require('./.infisical.json').workspaceId")" --silent -- "$@"
fi

exec infisical run --env="$ENV_SLUG" --silent -- "$@"
