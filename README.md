## Configuration

| Variable | Source | Purpose |
|---|---|---|
| `PORT` | Infisical, `.env` for a local run | port the HTTP server listens on |
| `DB_URL` | Infisical, `.env` for a local run | PostgreSQL host, port, database and user, without a password |
| `DB_PASSWORD_FILE` | `.env`, default `secrets/db_password` | path to the file with the database password |
| `LOG_LEVEL` | `.env`, default `info` | minimum log level |
| `TIMEOUT_MS` | `.env`, default `5000` | database connection timeout |

`.env.example` is the configuration contract with fake values. The real `.env` and `secrets/db_password` are not committed. The database password is never read from the environment.

### Environment variables

Application configuration is validated on startup using Zod through NestJS `ConfigModule`.

```env
PORT=5001
DB_URL=postgres://app_user@localhost:5432/marketplace
DB_PASSWORD_FILE=secrets/db_password
LOG_LEVEL=info
TIMEOUT_MS=5000
```

`PORT` and `DB_URL` are required. `DB_URL` provides the host, port, database and user; the password comes from the secret file. Use `localhost` when running on the host and `postgres` when running through Compose.

`DB_PASSWORD_FILE` is the path to the file with the database password, resolved from the working directory.

Default: `secrets/db_password`.

`LOG_LEVEL` accepts only:

* `debug`
* `info`
* `warn`
* `error`

Default: `info`.

`TIMEOUT_MS` must be a positive integer.

Default: `5000`.

Invalid configuration causes the application to fail during startup.

Check that `.env.example` matches the Zod schema:

```bash
npm run check:env
```

### PostgreSQL

Start PostgreSQL:

```bash
docker compose up -d postgres
```

The local database configuration is:

```text
Database: marketplace
User: app_user
Port: 5432
```

The database password is stored in:

```text
secrets/db_password
```

The `secrets/` directory is excluded from Git and Docker build context. The development credentials of the Postgres container itself stay in `docker-compose.yml`, so a fresh clone can start the database without any secret.

### Application

Start the application together with PostgreSQL:

```bash
docker compose up -d --build
```

The application connects to PostgreSQL over the Docker network, so it runs inside Compose rather than on the host.

The development image with a bind mount and file watching lives in a separate Compose file and is not picked up automatically:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The application listens on port `5001`.

Check the health endpoint:

```bash
curl http://localhost:5001/health
```

Expected response:

```json
{
  "status": "ok",
  "database": true,
  "uptime": 39.67
}
```

### Password rotation

Database password rotation is performed by:

```bash
bash rotate.sh
```

The script:

1. changes the PostgreSQL password using `ALTER ROLE`;
2. updates `secrets/db_password`;
3. terminates existing connections for `app_user`.

The application process is not restarted: `uptime` in `/health` keeps growing after rotation.

After rotation, verify the database connection:

```bash
curl http://localhost:5001/health
```

The expected response remains:

```json
{
  "status": "ok",
  "database": true,
  "uptime": 39.67
}
```

### Infisical

Application configuration is stored in an Infisical project, so a local run does not need `.env` at all:

```bash
infisical run -- npm run start
```

The project holds `PORT`, `DB_URL` and `DB_PASSWORD`.

The database password is never read from the environment by the application. It is read from `secrets/db_password` on every new connection, and that is what makes rotation without a restart possible.

On a fresh checkout the secret file can be materialised from Infisical:

```bash
npm run secrets:seed
```

The script refuses to overwrite an existing `secrets/db_password`: after a rotation the file holds the current password while Infisical may still hold the previous one. Pass `--force` to reset it deliberately.

### Docker

Build the application image:

```bash
docker build -t myapp .
```

Local secrets are excluded from the Docker build context through `.dockerignore`.

The image must not contain:

```text
.env
secrets/
```

Verify that `.env` is absent:

```bash
docker run --rm myapp sh -c 'cat /app/.env' 2>&1
```

Verify that no database password is present in image environment variables:

```bash
docker inspect --format '{{.Config.Env}}' myapp
```

Verify that no password is present in Docker build history:

```bash
docker history --no-trunc myapp | grep -i password
```

## Database

Main table: `orders`. Search table: `products`.

Bring up the database on a fresh clone:

```bash
docker compose down -v && docker compose up -d --wait postgres
```

Connect to it:

```bash
docker compose exec postgres psql -U app_user -d marketplace
```

Run all steps in the grader order. Each SQL file is passed to `psql` inside the container through stdin:

```bash
docker compose exec -T postgres psql -U app_user -d marketplace -v ON_ERROR_STOP=1 < db/schema.sql
docker compose exec -T postgres psql -U app_user -d marketplace -v ON_ERROR_STOP=1 < db/seed.sql
(echo "EXPLAIN (ANALYZE, BUFFERS)"; cat db/queries/q1.sql) | docker compose exec -T postgres psql -U app_user -d marketplace
docker compose exec -T postgres psql -U app_user -d marketplace -v ON_ERROR_STOP=1 < db/indexes.sql
docker compose exec -T postgres psql -U app_user -d marketplace -c "ANALYZE;"
(echo "EXPLAIN (ANALYZE, BUFFERS)"; cat db/queries/q1.sql) | docker compose exec -T postgres psql -U app_user -d marketplace
```

Repeat the two `EXPLAIN` lines for `q2.sql`, `q3.sql` and `q4.sql`. Run `q4.sql` two or three times after the indexes, the first run is cold.

Files:

```text
db/schema.sql        tables, constraints, generated tsvector column
db/seed.sql          5,000 users, 126,000 products, 200,000 orders, ~400,000 order items, VACUUM (ANALYZE)
db/indexes.sql       composite, partial, expression and GIN indexes plus two foreign key indexes on order_items
db/queries/q1..q4    real API queries, one statement per file
db/OPTIMIZATIONS.md  EXPLAIN plans before and after, foreign key indexes, morphology section
```