#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER=one-marketplace
IMAGE="${IMAGE:-one-marketplace-api:hw28}"
DEPENDENCIES="pgbouncer rabbitmq redis-cache redis-queue storage"

kind get clusters 2>/dev/null | grep -qx "$CLUSTER" || kind create cluster --config "$ROOT/k8s/kind-config.yaml" --wait 120s
kind load docker-image "$IMAGE" --name "$CLUSTER"

for service in $DEPENDENCIES; do
    container=$(docker compose -f "$ROOT/docker-compose.yml" ps -q "$service")
    [ -n "$container" ] || { echo "service $service is not running, start it with docker compose up -d --wait" >&2; exit 1; }
    docker network inspect kind -f '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$(docker inspect -f '{{.Name}}' "$container" | tr -d /)" \
        || docker network connect --alias "$service" kind "$container"
done
