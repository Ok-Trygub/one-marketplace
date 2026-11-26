#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/aws-evidence.sh"

DB=$(demo_output dbInstanceId)
az() { aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB" --query 'DBInstances[0].AvailabilityZone' --output text; }
status() { aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB" --query 'DBInstances[0].DBInstanceStatus' --output text; }

until [ "$(status)" = available ]; do sleep 10; done
before=$(az)
started=$(date +%s)
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)

aws rds reboot-db-instance --region "$REGION" --db-instance-identifier "$DB" --force-failover >/dev/null
sleep 5
until [ "$(status)" = available ]; do sleep 5; done

seconds=$(( $(date +%s) - started ))
after=$(az)
event=$(aws rds describe-events --region "$REGION" --source-type db-instance --source-identifier "$DB" --start-time "$since" \
    --query 'Events[?contains(Message, `failover`)].Message | [-1]' --output text)

set_evidence az-before "$before"
set_evidence az-after "$after"
set_evidence failover-seconds "$seconds"
set_evidence event "$event"

[ "$before" != "$after" ]
