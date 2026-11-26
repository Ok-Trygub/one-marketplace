#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGIONS=("${AWS_REGION:-eu-central-1}" us-east-1)
TAG="Key=Project,Values=nodejs-pro-hw31"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi-aws}"

if [ "${1:-}" != --checks-only ]; then
    for project in demo base; do
        bash "$ROOT/scripts/aws-pulumi.sh" "$project" destroy --yes --skip-preview || exit 1
    done
fi

STATE="$(mktemp)"
for project in demo base; do
    (cd "$ROOT/infra/$project" && pulumi stack export --stack "$project")
done | jq -s '[.[].deployment.resources[]?]' > "$STATE"

state_count() { jq --arg prefix "$1" '[.[] | select(.type | startswith($prefix))] | length' "$STATE"; }

api_count() {
    local result
    if result=$(aws "$@" 2>/dev/null); then
        echo "$result"
    else
        echo unavailable
    fi
}

tagged_count() {
    local arns deleted
    arns=$(aws resourcegroupstaggingapi get-resources --region "$1" --tag-filters "$TAG" --query 'ResourceTagMappingList[].ResourceARN' --output json) || { echo unavailable; return; }
    deleted=$(aws ec2 describe-nat-gateways --region "$1" --filter Name=state,Values=deleted --query 'NatGateways[].NatGatewayId' --output json 2>/dev/null || echo '[]')
    jq -n --argjson arns "$arns" --argjson deleted "${deleted:-[]}" '[$arns[] | select((split("/") | last) as $id | ($deleted | index($id)) | not)] | length'
}

tagged=0; rds=0; alb=0; nat=0; eip=0
for region in "${REGIONS[@]}"; do
    region_tagged=$(tagged_count "$region")
    region_rds=$(api_count rds describe-db-instances --region "$region" --query 'length(DBInstances)')
    region_alb=$(api_count elbv2 describe-load-balancers --region "$region" --query 'length(LoadBalancers)')
    region_nat=$(api_count ec2 describe-nat-gateways --region "$region" --filter Name=state,Values=available --query 'length(NatGateways)')
    region_eip=$(api_count ec2 describe-addresses --region "$region" --query 'length(Addresses)')

    if [ "$region_rds" = unavailable ]; then
        echo "region-$region-rds-source=pulumi-state, the RDS API is not available here"
        region_rds=$(state_count aws:rds/)
    fi
    if [ "$region_alb" = unavailable ]; then
        echo "region-$region-alb-source=pulumi-state, the ELBv2 API is not available here"
        region_alb=$(state_count aws:lb/)
    fi

    echo "region-$region-tagged=$region_tagged region-$region-rds=$region_rds region-$region-alb=$region_alb region-$region-nat=$region_nat region-$region-eip=$region_eip"
    tagged=$((tagged + region_tagged)); rds=$((rds + region_rds)); alb=$((alb + region_alb)); nat=$((nat + region_nat)); eip=$((eip + region_eip))
done

state_left=$(state_count aws:)
rm -f "$STATE"

echo "state-resources-left=$state_left"

DEMOS="$ROOT/evidence/demos.txt"
touch "$DEMOS"
grep -v '^state-resources-left=' "$DEMOS" > "$DEMOS.tmp" || true
echo "state-resources-left=$state_left" >> "$DEMOS.tmp"
mv "$DEMOS.tmp" "$DEMOS"
echo "tagged-resources-left=$tagged"
echo "rds-left=$rds"
echo "alb-left=$alb"
echo "nat-left=$nat"
echo "eip-left=$eip"

[ "$state_left" -eq 0 ] && [ "$tagged" -eq 0 ] && [ "$rds" -eq 0 ] && [ "$alb" -eq 0 ] && [ "$nat" -eq 0 ] && [ "$eip" -eq 0 ]
