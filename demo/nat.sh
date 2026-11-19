#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/aws-evidence.sh"

restore() { bash "$ROOT/scripts/aws-pulumi.sh" demo config set hw31:withNat false >/dev/null 2>&1 || true; }
trap restore EXIT

bash "$ROOT/scripts/aws-pulumi.sh" demo up --yes --target-dependents \
    --target "urn:pulumi:demo::one-marketplace-aws-demo::aws:ec2/natGateway:NatGateway::measured" \
    --target "urn:pulumi:demo::one-marketplace-aws-demo::aws:ec2/eip:Eip::nat" \
    --config hw31:withNat=true >/dev/null
NAT=$(demo_output natGatewayId)
created=$(aws ec2 describe-nat-gateways --region "$REGION" --nat-gateway-ids "$NAT" --query 'NatGateways[0].CreateTime' --output text)

bash "$ROOT/scripts/aws-pulumi.sh" demo up --yes --target-dependents \
    --target "urn:pulumi:demo::one-marketplace-aws-demo::aws:ec2/natGateway:NatGateway::measured" \
    --target "urn:pulumi:demo::one-marketplace-aws-demo::aws:ec2/eip:Eip::nat" \
    --config hw31:withNat=false >/dev/null
deleted=$(aws ec2 describe-nat-gateways --region "$REGION" --nat-gateway-ids "$NAT" --query 'NatGateways[0].DeleteTime' --output text)
[ "$deleted" != None ] || deleted=$(date -u +%Y-%m-%dT%H:%M:%SZ)

seconds=$(node -e 'console.log(Math.round((Date.parse(process.argv[1]) - Date.parse(process.argv[2])) / 1000))' "$deleted" "$created")
minutes=$(( (seconds + 59) / 60 ))
billed_hours=$(( (minutes + 59) / 60 ))

set_evidence nat-minutes "$minutes"
set_evidence nat-billed-hours "$billed_hours"
set_evidence nat-left "$(aws ec2 describe-nat-gateways --region "$REGION" --filter Name=state,Values=available --query 'length(NatGateways)')"
