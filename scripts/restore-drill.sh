#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:17}"

: "${DATABASE_URL:?DATABASE_URL is not set}"

without_scheme="${DATABASE_URL#*://}"
credentials="${without_scheme%%@*}"
DB_USER="${credentials%%:*}"
DB_PASSWORD="${credentials#*:}"
[ "$DB_PASSWORD" = "$credentials" ] && DB_PASSWORD=""
after_host="${without_scheme#*@}"
DB_NAME="${after_host#*/}"
DB_NAME="${DB_NAME%%\?*}"

DUMP="$(ls -1t "$BACKUP_DIR"/"${DB_NAME}"-*.dump 2>/dev/null | head -1 || true)"

if [ -z "$DUMP" ]; then
  echo "no dumps found in $BACKUP_DIR, run scripts/backup.sh first" >&2
  exit 1
fi

TABLE_COUNTS_SQL="WITH t AS (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') SELECT coalesce(string_agg(format('%s=%s', table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text), ',' ORDER BY table_name), 'no-tables') FROM t"
ORDERS_SUM_SQL="SELECT CASE WHEN to_regclass('public.orders') IS NULL THEN 'orders:absent' ELSE 'orders:' || (xpath('/row/c/text()', query_to_xml('select count(*) || ''|'' || coalesce(sum(total), 0) as c from public.orders', false, true, '')))[1]::text END"

control_source() {
  docker compose exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
    psql -h pgbouncer -p 6432 -U "$DB_USER" -d "$DB_NAME" -Atc "$1"
}

control_target() {
  docker exec "$TARGET" psql -U "$DB_USER" -d "$DB_NAME" -Atc "$1"
}

cd "$ROOT"

TARGET="restore-drill-$(date +%Y%m%d%H%M%S)-$$"

trap 'docker rm -f -v "$TARGET" > /dev/null 2>&1 || true' EXIT

echo "dump: $DUMP"
echo "size: $(wc -c < "$DUMP" | tr -d ' ') bytes"

SOURCE_TABLES="$(control_source "$TABLE_COUNTS_SQL")"
SOURCE_ORDERS="$(control_source "$ORDERS_SUM_SQL")"

docker run -d --name "$TARGET" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="${DB_PASSWORD:-drill}" \
  -e POSTGRES_DB="$DB_NAME" \
  "$POSTGRES_IMAGE" > /dev/null

for _ in $(seq 1 60); do
  if docker logs "$TARGET" 2>&1 | grep -q "PostgreSQL init process complete" \
    && docker exec "$TARGET" pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

STARTED_AT="$(date +%s)"

docker exec -i "$TARGET" pg_restore --no-owner --no-privileges -U "$DB_USER" -d "$DB_NAME" < "$DUMP"

RESTORE_SECONDS="$(( $(date +%s) - STARTED_AT ))"

TARGET_TABLES="$(control_target "$TABLE_COUNTS_SQL")"
TARGET_ORDERS="$(control_target "$ORDERS_SUM_SQL")"

echo "restore container: $TARGET"
echo "restore time: ${RESTORE_SECONDS} s"
echo "source tables: $SOURCE_TABLES"
echo "target tables: $TARGET_TABLES"
echo "source $SOURCE_ORDERS"
echo "target $TARGET_ORDERS"

if [ "$SOURCE_TABLES" = "$TARGET_TABLES" ] && [ "$SOURCE_ORDERS" = "$TARGET_ORDERS" ]; then
  echo "MATCH"
else
  echo "MISMATCH" >&2
  exit 1
fi
