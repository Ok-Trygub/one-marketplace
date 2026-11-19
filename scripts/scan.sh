#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-one-marketplace-api:hw28}"
SEVERITY="${SCAN_SEVERITY:-HIGH,CRITICAL}"
MAX="${SCAN_MAX:?SCAN_MAX is required: the highest number of findings that still passes}"
TRIVY_IMAGE="aquasec/trivy:0.76.1"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

docker save "$IMAGE" -o "$WORK/image.tar"
docker run --rm -v trivy-cache:/root/.cache/trivy -v "$WORK:/work" "$TRIVY_IMAGE" image \
    --quiet --input /work/image.tar --severity "$SEVERITY" --format json --output /work/report.json

found=$(node -e '
const report = require(process.argv[1])
const findings = (report.Results ?? []).flatMap((result) => result.Vulnerabilities ?? [])
console.log(findings.length)' "$WORK/report.json")

echo "image=$IMAGE"
echo "severity=$SEVERITY"
echo "found=$found"
echo "max-allowed=$MAX"

if [ "$found" -le "$MAX" ]; then
    echo "gate=pass"
else
    echo "gate=fail"
    exit 1
fi
