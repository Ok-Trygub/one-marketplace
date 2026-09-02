#!/bin/bash

set -e

NEW_PASSWORD="rotated_password"

echo "1. Changing PostgreSQL password..."

docker compose exec -T postgres \
  psql -U app_user -d marketplace \
  -c "ALTER ROLE app_user PASSWORD '${NEW_PASSWORD}'"

echo "2. Updating secret file..."

printf '%s\n' "$NEW_PASSWORD" > secrets/db_password

echo "3. Terminating old PostgreSQL connections..."

docker compose exec -T postgres \
  psql -U app_user -d marketplace \
  -c "SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE usename = 'app_user'
        AND pid <> pg_backend_pid();"

echo "Rotation completed."