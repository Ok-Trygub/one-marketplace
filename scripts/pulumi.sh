#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
export PULUMI_NODEJS_TRANSPILE_ONLY=true
case "$PULUMI_BACKEND_URL" in file://*) mkdir -p "${PULUMI_BACKEND_URL#file://}" ;; esac

cd "$ROOT/infra"
pulumi stack select dev --create --non-interactive
pulumi "$@" --yes --non-interactive
sed -i.bak '/^encryptionsalt:/d' Pulumi.dev.yaml && rm -f Pulumi.dev.yaml.bak
