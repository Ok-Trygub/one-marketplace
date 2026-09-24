## Configuration

| Variable | Source | Purpose |
|---|---|---|
| `PORT` | Infisical, `.env` for a local run | port the HTTP server listens on |
| `DB_URL` | Infisical, `.env` for a local run | PgBouncer host, port, database and user, without a password |
| `DATABASE_URL` | Infisical | full connection string through PgBouncer for `scripts/backup.sh` and `scripts/restore-drill.sh` |
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

### PostgreSQL and PgBouncer

Start the database stack:

```bash
docker compose up -d --wait
```

This starts Postgres and PgBouncer in front of it. The application, TypeORM and every demo connect to PgBouncer on port `6432`; Postgres on port `5432` stays published for backups and debugging.

```text
Database: marketplace
User: app_user
PgBouncer: 127.0.0.1:6432
Postgres: 127.0.0.1:5432
```

PgBouncer config lives in `pgbouncer/pgbouncer.ini`, the user list in `pgbouncer/userlist.txt`. The user list holds the development password from `docker-compose.yml`; in production it is generated from the vault at deploy time. After editing either file run `docker compose restart pgbouncer`. Admin console:

```bash
PGPASSWORD=first-pass psql -h 127.0.0.1 -p 6432 -U app_user -d pgbouncer -c "SHOW POOLS"
```

The database password for the HTTP application is stored in:

```text
secrets/db_password
```

The `secrets/` directory is excluded from Git and Docker build context. The development credentials of the Postgres container itself stay in `docker-compose.yml`, so a fresh clone can start the database without any secret.

**Why transaction mode.** `pool_mode = transaction` hands a server connection to a client only for the duration of one transaction, so 200 clients share 10 server connections and the pool survives many application instances. The price is everything that lives longer than a transaction: session settings such as `SET search_path` or `SET timezone` do not carry over to the next transaction, named prepared statements are bound to a connection the client no longer has, `LISTEN`/`NOTIFY` subscriptions and session-level advisory locks stay on a connection that is handed to someone else, and `WITH HOLD` cursors and temporary tables disappear with the session. This project survives it because all work runs inside `dataSource.transaction`, the `pg` driver does not name its prepared statements, `max_prepared_statements = 200` lets PgBouncer track the rest, and `server_reset_query = DISCARD ALL` cleans a connection before reuse.

### Application

Start the application together with PostgreSQL:

```bash
docker compose --profile app up -d --build
```

The application connects to PostgreSQL over the Docker network, so it runs inside Compose rather than on the host.

The development image with a bind mount and file watching lives in a separate Compose file and is not picked up automatically:

```bash
docker compose --profile app -f docker-compose.yml -f docker-compose.dev.yml up -d --build
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

The script also rewrites `pgbouncer/userlist.txt` and restarts PgBouncer, so the pooler keeps accepting the application; keep the development password in the committed file. The TypeORM data layer and the backup scripts need the new password too: update `DB_PASSWORD` and `DATABASE_URL` in Infisical, or export them in the shell together with `SKIP_VAULT=1`.

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

## TypeORM

`synchronize: false` in `src/data-source.ts`; the schema is created by the migration in `src/migrations/`. Connection values `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` come from `process.env`, injected by `scripts/with-secrets.sh` from Infisical.

```bash
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run seed
npm run demo:nplus1
npm run report
```

### onDelete

| Foreign key | onDelete | Why |
|---|---|---|
| `orders.user_id` → `users` | `RESTRICT` | order history must survive; a user with orders cannot be deleted |
| `order_items.product_id` → `products` | `RESTRICT` | a receipt keeps the product it refers to |
| `order_items.order_id` → `orders` | `CASCADE` | lines have no meaning without their order |

### Indexes

Five of the six indexes from `db/indexes.sql` are declared on the entities; `orders (user_id, created_at)` is unique. The expression index `users (lower(email))` is replaced by the check constraint `email = lower(email)`: TypeORM cannot declare expression indexes, so emails are stored lowercased and `WHERE email = lower($1)` is served by the unique index on `email`. `@Index` cannot express `DESC` either, so the two `created_at` indexes are ascending; a B-tree is scanned backwards at the same cost.

### Seed

`npm run seed` is idempotent, including two runs in parallel. Every natural key is backed by a unique constraint: `users.email`, `products.name`, `orders (user_id, created_at)`. Rows are inserted with `ON CONFLICT DO NOTHING`, and an order is inserted together with its items in one transaction. Row counts after any number of runs:

```bash
docker compose exec postgres psql -U app_user -d marketplace -c "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items"
```

```text
 users | products | orders | order_items
-------+----------+--------+-------------
     6 |        8 |      7 |          12
```

### N+1

Graph `order → items → product`, queries counted by a custom `Logger` with `logging: ['query']`:

| Strategy | N = 3 | N = 7 |
|---|---|---|
| naive, query per element in a loop | 9 | 20 |
| `relations` / LEFT JOIN | 1 | 1 |
| `relationLoadStrategy: 'query'` | 4 | 4 |

Naive is `1 + N + M` where `M` is the number of order items. The fixed variants do not depend on `N`. The `query` strategy issues one query per relation level plus one service query in which TypeORM maps items back to their orders, hence 4 instead of 3, within the `1 + 2 × levels` bound.

### Repository vs QueryBuilder

`npm run report` prints revenue per product across paid orders through `createQueryBuilder().getRawMany()` with `JOIN`, `SUM` and `GROUP BY`. `Repository` is used whenever the result is a set of entities: reading, writing and loading relations. `QueryBuilder` is used whenever the result is not an entity: aggregates, grouping, raw rows. `SUM` comes back as a `bigint` string, so the report formats money through `BigInt` and never through `Number`.

## Конкурентність

```bash
npm run demo:race
npm run demo:workers
npm run demo:retry
```

| Demo | My run |
|---|---|
| `demo:race` | 50 parallel checkouts on `stock = 10`: 10 succeeded, final stock 0, rows with negative stock 0 |
| `demo:workers` | own queue per run: 20 regular jobs and 1 poison job, 4 workers, 5 each, processed twice 0, poison job marked `failed` after 3 attempts while all workers keep running, 539 ms against 2000 ms sequentially |
| `demo:retry` | 3 concurrent debits under `REPEATABLE READ`: 3 caught `40001`, each retried, final balance 970000 as expected |

**Atomic UPDATE vs pessimistic lock.** Checkout uses `UPDATE ... SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING`. The check, the change and the row lock are one statement, so there is no window between reading and writing; zero returned rows means sold out and the transaction rolls back as a whole. `SELECT ... FOR UPDATE` is equally safe but costs an extra round trip, holds the lock longer and leaves application code between the read and the write. Checkout does not need the row data to decide, so the atomic form is used.

**Why retry catches only 40001 and 40P01.** Serialization failure and deadlock mean the transaction lost a timing race while data and code are correct, so running it again from the start, reads included, is expected to succeed. Any other error is deterministic or ambiguous: a constraint violation fails the same way again, and after a broken connection a blind retry could apply the change twice.

## Data layer ops

```text
scripts/backup.sh          pg_dump -Fc through PgBouncer into backups/<db>-<date>.dump, verified with pg_restore --list
scripts/restore-drill.sh   restores the latest dump into a new empty postgres:17 container, compares control values, prints MATCH
backup.cron                nightly schedule at 03:00, adjust the repository path for the target host
RESTORE-DRILL.md           drill protocol with measured RTO and RPO
```

Both scripts take the connection from `DATABASE_URL`, which `scripts/with-secrets.sh` injects from the vault. Only the user, password and database name are used: the dump runs inside the `postgres` container and reaches PgBouncer as `pgbouncer:6432`.

Backup:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```

Prints the dump path and size. The last 7 dumps are kept, the directory `backups/` is outside Git.

Restore drill:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Takes the latest dump, restores it into a fresh container, compares row counts of every table and `count | sum(total)` of `orders`, prints `MATCH` or exits with code 1, and removes the container. Run it right after a backup: a drill compares against the live database, so writes in between produce an honest `MISMATCH`.

Restore into the real database, for example after `docker compose down -v`:

```bash
docker compose up -d --wait
docker compose exec -T postgres pg_restore --no-owner --no-privileges -U app_user -d marketplace < backups/<file>.dump
```

The host `pg_restore` may be older than the server, so archive inspection and restores run inside the container.

## Тестування

```bash
npm run test:integration   # repositories against postgres:16-alpine started by testcontainers
npm run test:e2e           # full Nest application through supertest, database from a testcontainer
npm run test:contract      # Pact consumer test, writes pacts/marketplace-frontend-marketplace-api.json
npm run verify:provider    # Pact provider verification of the real application
```

Docker must be running: every suite starts its own Postgres container from the test code. Tests are compiled by `tsc` together with the application and run from `dist/test`; `jest.config.js` sets `reporters: ['default']` and `maxWorkers: 1`.

**Isolation.** Every test file starts its own container and runs the migrations, and `TRUNCATE ... RESTART IDENTITY CASCADE` clears all tables before each test. A transaction-with-rollback strategy would not work here: checkout and the worker open their own transactions through `dataSource.transaction`, and TypeORM would commit them independently of the test transaction. Truncating five small tables costs milliseconds, and a fresh container per file keeps files independent, so the suite is green on any number of consecutive runs. Test data comes from builders in `test/integration/testkit/builders.ts` (`aUser`, `aProduct`, `anOrder`) with unique defaults.

**Contract.** The consumer `marketplace-frontend` describes two interactions of `marketplace-api`: `GET /orders/{id}` under the state `order with id 1 exists` and `GET /products` under `products exist`. Both paths come from `openapi/openapi.yaml`. The generated contract in `pacts/` is committed. `verify:provider` starts the real application on a random port with a testcontainer database, seeds the provider states with `INSERT ... ON CONFLICT DO NOTHING` and verifies every interaction. Without `PACT_BROKER_URL` it reads the local pact file; with it, it fetches the contract from the broker and publishes the result (`publishVerificationResult: true`). The code reads only `process.env.PACT_BROKER_URL` and `process.env.PACT_BROKER_TOKEN`; the token is sent only when set, the local broker has no authentication.

Two ways to run the verification against the broker:

```bash
bash scripts/with-secrets.sh dev npm run verify:provider          # primary: PACT_BROKER_URL comes from the vault
PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider     # grader form: the value is passed directly
```

**Broker locally.** `docker compose up -d --wait` starts `pact-broker` on `http://127.0.0.1:9292` next to Postgres and PgBouncer; it keeps its data in an SQLite file inside the container. The gate sequence, run for version `5d8984d` (the git short sha, used for both pacticipants):

```bash
export PACT_BROKER_URL=http://127.0.0.1:9292
export PACT_VERSION=$(git rev-parse --short HEAD)
curl -X PUT "$PACT_BROKER_URL/pacts/provider/marketplace-api/consumer/marketplace-frontend/version/$PACT_VERSION" -H 'Content-Type: application/json' --data-binary @pacts/marketplace-frontend-marketplace-api.json
npm run verify:provider
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-frontend&version=$PACT_VERSION&to=prod"
curl -X PUT "$PACT_BROKER_URL/pacticipants/marketplace-api/versions/$PACT_VERSION/tags/prod" -H 'Content-Type: application/json'
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-frontend&version=$PACT_VERSION&to=prod"
```

can-i-deploy before the `prod` tag:

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 5d8984d of marketplace-frontend and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}}
```

can-i-deploy after the `prod` tag:

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}}
```

**CI.** `.github/workflows/contract.yml` runs the job `contract` on every push and pull request: broker from compose, `test:contract`, publish, `verify:provider` with `PACT_VERSION=${{ github.sha }}`, then a can-i-deploy step that queries the broker matrix for both pacticipant versions and fails the job unless `deployable` is `true`. `PACT_BROKER_URL` and `PACT_BROKER_TOKEN` come from GitHub secrets, with the local compose address as the default.

## Grading

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=app_user DB_PASSWORD=first-pass DB_NAME=marketplace
export DATABASE_URL=postgres://app_user:first-pass@127.0.0.1:6432/marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
npm ci
npm run build
npm run migrate
npm run seed
npm run demo:race
npm run demo:workers
npm run demo:retry
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
npm run test:integration
npm run test:e2e
npm run test:contract
export PACT_BROKER_URL=http://127.0.0.1:9292
export PACT_VERSION=$(git rev-parse --short HEAD)
curl -X PUT "$PACT_BROKER_URL/pacts/provider/marketplace-api/consumer/marketplace-frontend/version/$PACT_VERSION" -H 'Content-Type: application/json' --data-binary @pacts/marketplace-frontend-marketplace-api.json
bash scripts/with-secrets.sh dev npm run verify:provider
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-frontend&version=$PACT_VERSION&to=prod"
curl -X PUT "$PACT_BROKER_URL/pacticipants/marketplace-api/versions/$PACT_VERSION/tags/prod" -H 'Content-Type: application/json'
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-frontend&version=$PACT_VERSION&to=prod"
```
