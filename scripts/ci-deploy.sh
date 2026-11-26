#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_REF="${IMAGE_REF:?IMAGE_REF is required: the image the cluster runs}"
OUT="${OUT_DIR:?OUT_DIR is required: where the deploy evidence goes}"
REV="${REV:-$IMAGE_REF}"
NAMESPACE=marketplace
DEPLOYMENT=marketplace-api

mkdir -p "$OUT"
cd "$ROOT"

docker compose up -d --wait
npm run build --silent
npm run migrate --silent
npm run seed --silent

IMAGE="$IMAGE_REF" bash scripts/cluster-up.sh

bash scripts/with-secrets.sh dev bash scripts/pulumi.sh preview --json --config "image=$IMAGE_REF" --config "rev=$REV" > "$OUT/plan.json"

if ! PLAN_JSON="$OUT/plan.json" npm run --silent gate:cost; then
    if [ "${COST_BYPASS:-false}" = true ]; then
        echo "cost gate failed, the bypass label is set on the pull request"
    else
        exit 1
    fi
fi

bash scripts/with-secrets.sh dev bash scripts/pulumi.sh up --config "image=$IMAGE_REF" --config "rev=$REV"
kubectl -n "$NAMESPACE" rollout status "deploy/$DEPLOYMENT" --timeout=300s
kubectl -n "$NAMESPACE" get deploy "$DEPLOYMENT" -o json > "$OUT/deployment.json"

deployed_digest=$(node -e 'const d=require(process.argv[1]);const m=/sha256:[0-9a-f]{64}/.exec(d.spec.template.spec.containers[0].image);console.log(m?m[0]:"")' "$OUT/deployment.json")
occurrences=$(node scripts/secret-occurrences.mjs "$NAMESPACE" marketplace-api-env "$OUT/deployment.json" "$OUT/plan.json")
in_manifest=$(echo "$occurrences" | grep -F "$OUT/deployment.json=" | cut -d= -f2)
in_plan=$(echo "$occurrences" | grep -F "$OUT/plan.json=" | cut -d= -f2)

set +e
npm run --silent demo:rollout | tee "$OUT/rollout.txt"
rollout_status=${PIPESTATUS[0]}
set -e

value_of() { sed -n "s/^$1=//p" "$OUT/rollout.txt" | tail -1; }

{
    echo "deployed-digest=$deployed_digest"
    echo "secret-in-manifest=$in_manifest"
    echo "secret-in-plan=$in_plan"
    echo "rollout-requests=$(value_of requests)"
    echo "rollout-ok=$(value_of ok)"
    echo "rollout-failed=$(value_of failed)"
    echo "rollout-seconds=$(value_of rollout-seconds)"
} > "$OUT/deploy.txt"
cat "$OUT/deploy.txt"

[ "$rollout_status" = 0 ] && [ "$in_manifest" = 0 ] && [ "$in_plan" = 0 ]
