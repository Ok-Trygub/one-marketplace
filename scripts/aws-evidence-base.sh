#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-eu-central-1}"
OUT="$ROOT/evidence"
mkdir -p "$OUT"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi-aws}"
cd "$ROOT/infra/base"
pulumi stack select base --non-interactive >/dev/null

output() { pulumi stack output "$1" --json; }
VPC_ID=$(output vpcId | jq -r .)
PRIVATE_SUBNETS=$(output privateSubnetIds | jq -r 'join(",")')
ROLE_ARN=$(output teardownRoleArn | jq -r .)
POLICY_ARN=$(output teardownPolicyArn | jq -r .)
ROLE_NAME=${ROLE_ARN##*/}

public_subnets=$(aws ec2 describe-subnets --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Tier,Values=public --query 'length(Subnets)')
private_subnets=$(aws ec2 describe-subnets --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Tier,Values=private --query 'length(Subnets)')
subnet_azs=$(aws ec2 describe-subnets --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query 'Subnets[].AvailabilityZone' --output json | jq 'unique | length')
private_default_route=$(aws ec2 describe-route-tables --region "$REGION" --filters Name=association.subnet-id,Values="$PRIVATE_SUBNETS" --output json \
    | jq '[.RouteTables[].Routes[] | select(.DestinationCidrBlock == "0.0.0.0/0")] | length')
security_groups=$(aws ec2 describe-security-groups --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query 'length(SecurityGroups[?GroupName!=`default`])')
tagged_resources=$(aws resourcegroupstaggingapi get-resources --region "$REGION" --tag-filters Key=Project,Values=nodejs-pro-hw31 --query 'length(ResourceTagMappingList)')

{
    echo "vpc-id=$VPC_ID"
    echo "public-subnets=$public_subnets"
    echo "private-subnets=$private_subnets"
    echo "subnet-azs=$subnet_azs"
    echo "private-default-route=$private_default_route"
    echo "security-groups=$security_groups"
    echo "tagged-resources=$tagged_resources"
} | tee "$OUT/base.txt"

pulumi stack export > "$OUT/base-state.json"

ROLE=$(aws iam get-role --role-name "$ROLE_NAME" --output json)
VERSION=$(aws iam get-policy --policy-arn "$POLICY_ARN" --query 'Policy.DefaultVersionId' --output text)
POLICY=$(aws iam get-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION" --output json)
node -e '
const role = JSON.parse(process.argv[1]).Role
const version = JSON.parse(process.argv[2]).PolicyVersion
const decode = (document) => (typeof document === "string" ? JSON.parse(decodeURIComponent(document)) : document)
console.log(JSON.stringify({
    RoleName: role.RoleName,
    Arn: role.Arn,
    TrustPolicy: decode(role.AssumeRolePolicyDocument),
    PermissionPolicy: decode(version.Document),
}, null, 2))' "$ROLE" "$POLICY" > "$OUT/iam.json"

simulate() {
    aws iam simulate-principal-policy --policy-source-arn "$ROLE_ARN" --action-names "$1" --query 'EvaluationResults[0].EvalDecision' --output text 2>/dev/null || echo unavailable
}
{
    echo "sim-allowed=$(simulate rds:DeleteDBInstance)"
    echo "sim-denied=$(simulate iam:CreateUser)"
} | tee "$OUT/iam.txt"
