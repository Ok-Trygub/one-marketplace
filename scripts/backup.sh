#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP_LAST="${KEEP_LAST:-7}"

: "${DATABASE_URL:?DATABASE_URL is not set}"

without_scheme="${DATABASE_URL#*://}"
credentials="${without_scheme%%@*}"
DB_USER="${credentials%%:*}"
DB_PASSWORD="${credentials#*:}"
[ "$DB_PASSWORD" = "$credentials" ] && DB_PASSWORD=""
after_host="${without_scheme#*@}"
DB_NAME="${after_host#*/}"
DB_NAME="${DB_NAME%%\?*}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"
PARTIAL="$TARGET.partial"

trap 'rm -f "$PARTIAL"' EXIT

cd "$ROOT"

docker compose exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
  pg_dump -Fc --no-owner -h pgbouncer -p 6432 -U "$DB_USER" "$DB_NAME" > "$PARTIAL"

docker compose exec -T postgres pg_restore --list < "$PARTIAL" > /dev/null

mv "$PARTIAL" "$TARGET"

SIZE_BYTES="$(wc -c < "$TARGET" | tr -d ' ')"

ls -1t "$BACKUP_DIR"/"${DB_NAME}"-*.dump 2>/dev/null | tail -n +"$((KEEP_LAST + 1))" | while read -r old; do
  rm -f "$old"
done

echo "backup: $TARGET"
echo "size: $SIZE_BYTES bytes"
