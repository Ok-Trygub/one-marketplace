#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:23166}"
REGION="${AWS_REGION:-eu-central-1}"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.localstack.yml")
USER_NAME="hw31-deny-all"
BUCKET="hw31-iam-probe"

status_of() {
    "$@" --debug 2>&1 | grep -oE 'HTTP/1\.1" [0-9]{3}' | tail -1 | grep -oE '[0-9]{3}$' || echo 000
}

[ "$("${COMPOSE[@]}" exec -T localstack printenv ENFORCE_IAM)" = "1" ] || { echo "LocalStack must run with ENFORCE_IAM=1" >&2; exit 1; }
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)

aws iam delete-user-policy --user-name "$USER_NAME" --policy-name deny-all >/dev/null 2>&1 || true
for key in $(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
    aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$key"
done
aws iam delete-user --user-name "$USER_NAME" >/dev/null 2>&1 || true

aws iam create-user --user-name "$USER_NAME" >/dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name deny-all \
    --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"*","Resource":"*"}]}'
read -r KEY SECRET < <(aws iam create-access-key --user-name "$USER_NAME" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)

as_user() {
    env -u AWS_ROLE_ARN -u AWS_WEB_IDENTITY_TOKEN_FILE AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" \
        aws --endpoint-url "$ENDPOINT" --region "$REGION" "${@:3}"
}

printf 'probe body' > /tmp/hw31-probe.txt
create=$(status_of as_user "$KEY" "$SECRET" s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION")
put=$(status_of as_user "$KEY" "$SECRET" s3api put-object --bucket "$BUCKET" --key probe.txt --body /tmp/hw31-probe.txt)
fake=$(status_of as_user TOTALLY_FAKE_KEY_12345 TOTALLY_FAKE_SECRET s3api get-object --bucket "$BUCKET" --key probe.txt /tmp/hw31-probe-read.txt)
log_lines=$("${COMPOSE[@]}" logs --since "$since" localstack 2>&1 | grep -ciE 'denied|not authori[sz]ed|enforc' || true)

as_user "$KEY" "$SECRET" s3api delete-object --bucket "$BUCKET" --key probe.txt >/dev/null 2>&1 || true
as_user "$KEY" "$SECRET" s3api delete-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true

{
    echo "enforce-iam=1"
    echo "deny-all-create-bucket=$create"
    echo "deny-all=$put"
    echo "fake-key=$fake"
    echo "fake-key-body-match=$(cmp -s /tmp/hw31-probe.txt /tmp/hw31-probe-read.txt && echo 1 || echo 0)"
    echo "enforce-iam-log-lines=$log_lines"
} | tee "$ROOT/evidence/localstack-iam.txt"
