#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$1"
shift

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi-aws}"
export PULUMI_NODEJS_TRANSPILE_ONLY=true
case "$PULUMI_BACKEND_URL" in file://*) mkdir -p "${PULUMI_BACKEND_URL#file://}" ;; esac

cd "$ROOT/infra/$PROJECT"
pulumi stack select "$PROJECT" --create --non-interactive >/dev/null
status=0
pulumi "$@" --non-interactive || status=$?
sed -i.bak '/^encryptionsalt:/d' "Pulumi.$PROJECT.yaml" && rm -f "Pulumi.$PROJECT.yaml.bak"
exit "$status"
