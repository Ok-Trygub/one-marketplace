#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
export PULUMI_NODEJS_TRANSPILE_ONLY=true
case "$PULUMI_BACKEND_URL" in file://*) mkdir -p "${PULUMI_BACKEND_URL#file://}" ;; esac

cd "$ROOT/infra"
pulumi stack select dev --create --non-interactive >&2
if [ "${1:-}" = preview ]; then
    pulumi "$@" --non-interactive
else
    pulumi "$@" --yes --non-interactive
fi
sed -i.bak '/^encryptionsalt:/d' Pulumi.dev.yaml && rm -f Pulumi.dev.yaml.bak
