#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/aws-evidence.sh"

DNS=$(demo_output albDnsName)
TARGET_GROUP=$(demo_output targetGroupArn)

state=unknown
for _ in $(seq 1 30); do
    state=$(aws elbv2 describe-target-health --region "$REGION" --target-group-arn "$TARGET_GROUP" --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
    [ "$state" = healthy ] && break
    sleep 10
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$DNS/")

set_evidence alb-dns "$DNS"
set_evidence http-code "$code"
set_evidence target-state "$state"

[ "$code" = 200 ] && [ "$state" = healthy ]
