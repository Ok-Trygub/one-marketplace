## Configuration

| Variable | Source | Purpose |
|---|---|---|
| `PORT` | Infisical, `.env` for a local run | port the HTTP server listens on |
| `DB_URL` | Infisical, `.env` for a local run | PgBouncer host, port, database and user, without a password |
| `DATABASE_URL` | Infisical | full connection string through PgBouncer for `scripts/backup.sh` and `scripts/restore-drill.sh` |
| `DB_PASSWORD_FILE` | `.env`, default `secrets/db_password` | path to the file with the database password |
| `BROKER_URL` | Infisical, `.env` for a local run | AMQP address of RabbitMQ with the dev credentials from `docker-compose.yml` |
| `LOG_LEVEL` | `.env`, default `info` | minimum log level |
| `TIMEOUT_MS` | `.env`, default `5000` | database connection timeout |

`.env.example` is the configuration contract with fake values. The real `.env` and `secrets/db_password` are not committed. The database password is never read from the environment.

### Environment variables

Application configuration is validated on startup using Zod through NestJS `ConfigModule`.

```env
PORT=5001
DB_URL=postgres://app_user@localhost:5432/marketplace
DB_PASSWORD_FILE=secrets/db_password
BROKER_URL=amqp://app_user:first-pass@localhost:5672
LOG_LEVEL=info
TIMEOUT_MS=5000
```

`PORT` is required. `DB_URL` provides the host, port, database and user; the password comes from the secret file. When `DATABASE_URL` is set, for example by a testcontainer in the test suites, it takes precedence over `DB_URL` and the password file. Use `localhost` when running on the host and `postgres` when running through Compose.

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

**CI.** `.github/workflows/contract.yml` runs the job `contract` on every push and pull request: broker and `redis-queue` from compose, the second one because the guard on `GET /orders/{id}` checks the token denylist, `test:contract`, publish, `verify:provider` with `PACT_VERSION=${{ github.sha }}`, then a can-i-deploy step that queries the broker matrix for both pacticipant versions and fails the job unless `deployable` is `true`. `PACT_BROKER_URL` and `PACT_BROKER_TOKEN` come from GitHub secrets, with the local compose address as the default.

## Realtime

A status change of an order reaches connected clients at once, over two transports fed by one bus.

```
PATCH /orders/:id/status → OrderStatusService → OrderEventsService
                                                   ├─ OrdersGateway   → room orders:<id>
                                                   └─ GET /orders/:id/events
```

- `src/services/order-status.service.ts` changes the status with one atomic `UPDATE` and publishes the event. Allowed transitions: `pending ⇄ paid`, `pending → cancelled`, `paid → cancelled`; anything else is `409`.
- `src/services/order-events.service.ts` is the bus: an RxJS `Subject` plus an in-memory buffer of the last 100 events per order, kept for at most 1000 orders with the least recently changed order evicted first. Event numbers grow per order, starting from 1.
- `src/gateways/orders.gateway.ts` is the socket.io gateway. The client sends `join` with `{ orderId }` and gets an ack. The socket enters the room `orders:<id>` only when the access token in `auth.token` of the handshake is valid and belongs to the owner of the order; otherwise the ack is `UNAUTHORIZED`, `UNAVAILABLE`, `FORBIDDEN` or `ORDER_NOT_FOUND`. The event `order.status` goes only to that room.
- `GET /orders/:id/events` is the SSE stream of the same events with `id:`, `event:` and `data:`. It needs `Authorization: Bearer <access token>`: without a valid token the answer is `401`, for a buyer who does not own the order it is `403`. A new connection receives only new events; with `Last-Event-ID: N` it first receives the buffered events with a number greater than `N`. The stream ends after logout and at the token `exp`.

Both channels verify the same access token as the HTTP API, see [Auth](#auth). A browser `EventSource` cannot set headers, so a browser client would carry the token in a cookie.

Start the application on port 3000, after the database is up, migrated and seeded as in [Grading](#grading):

```bash
npm run build
PORT=3000 node dist/src/server.js
```

Demo of room isolation. It logs in as two seeded buyers and the seeded seller, takes an order of each buyer, connects two socket.io clients with the buyers' tokens, changes the status of order A as the seller and prints what each client received:

```bash
node scripts/realtime-demo.mjs; echo "exit=$?"               # different rooms: A_RECEIVED=1, B_RECEIVED=0, exit=0
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"   # both clients in the room of order A: A_RECEIVED=1, B_RECEIVED=1, exit=0
```

SSE by hand, as the seeded buyer and the seeded seller, with the id of an order of that buyer that is not cancelled:

```bash
login() { curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"marketplace-dev\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token"; }
BUYER=$(login olena.shevchenko@gmail.com)
SELLER=$(login taras.oliinyk@outlook.com)
curl -sN -H "Authorization: Bearer $BUYER" http://localhost:3000/orders/1/events &
curl -s -X PATCH http://localhost:3000/orders/1/status -H 'Content-Type: application/json' -H "Authorization: Bearer $SELLER" -d '{"status":"pending"}'
curl -sN --max-time 2 -H "Authorization: Bearer $BUYER" -H 'Last-Event-ID: 3' http://localhost:3000/orders/1/events
```

**Two instances.** With two instances behind a load balancer a status change handled by the first instance reaches only the clients connected to the first one, because the rooms and the event buffer live in the memory of one process, and a restart empties the buffer; the cure is the socket.io Redis adapter for the rooms and a shared bus such as Redis Pub/Sub for the SSE stream and its buffer.

## Trade-offs: WebSocket vs SSE

| Criterion | WebSocket, socket.io | SSE |
|---|---|---|
| Channel direction | Two-way: the client sends `join` and gets an ack over the same connection | One-way, server to client; the client speaks through ordinary HTTP requests |
| Reconnect and recovery | socket.io reconnects by itself, but the room is lost: the client must send `join` again, and events missed while offline are not replayed | The browser `EventSource` reconnects by itself after `retry: 1000` and sends `Last-Event-ID`; the server replays the missed events from the buffer |
| Infrastructure | Proxies and load balancers must pass the Upgrade handshake; the polling fallback needs sticky sessions; several instances need the Redis adapter | Plain HTTP, works through any proxy that does not buffer the response; HTTP/1.1 limits a browser to about six streams per domain; several instances need a shared bus |
| Cost per event | A frame of a few bytes on an open connection, plus heartbeat packets of socket.io | A text block of `id`, `event` and `data`, some tens of bytes more than a frame; one open HTTP response per watched order |

For order status notifications in production I would keep SSE. The flow is one-way, the reconnect with `Last-Event-ID` gives recovery of missed events for free, and it needs nothing from the infrastructure beyond plain HTTP. WebSocket earns its price only when the client has to send data often, for example in a chat.

## Async-події через RabbitMQ

```
POST /orders → PlaceOrderService → checkout + outbox, COMMIT → relay → publisher → [shop.events] topic
                                                                                         │ binding order.placed
                                                                                         ▼
                                                                               (shop.order-placed) quorum, x-delivery-limit 3
                                                                                         │ consumer: prefetch 10, manual ack
                                                                                         ├─ processed_messages + receipts ON CONFLICT DO NOTHING, one transaction → ack
                                                                                         └─ poison or delivery limit → [shop.dlx] → (shop.dlq)
```

- `src/messaging/topology.ts` declares the exchange `shop.events`, the quorum queue `shop.order-placed` bound to `order.placed`, and the dead-letter contour `shop.dlx` with the queue `shop.dlq`. The consumer and the demos declare it; the publisher asserts only the exchange and knows nothing about queues.
- `src/messaging/order-placed.event.ts` is the event contract: `eventId`, `type`, `occurredAt` and `data` with the order id, buyer, total and items. `eventId` is `order.placed:<order id>`, stable across republishes.
- `src/services/place-order.service.ts` runs the checkout transaction, which writes the event into `outbox`; the relay publishes it, see «Outbox та ідемпотентність». `src/messaging/order-placed.publisher.ts` publishes on a confirm channel with `mandatory: true` and waits for the confirm; a message the broker returns as unroutable becomes an error.
- `src/messaging/order-placed.consumer.ts` consumes with `noAck: false` and `prefetch 10`; the effect is one `INSERT` into `receipts` with a unique `event_id` and `ON CONFLICT DO NOTHING`, the ack comes after it. A message that is not valid JSON or does not match the contract is rejected without requeue; a database failure requeues it, and the quorum queue dead-letters it after 3 deliveries.
- `src/consumer.ts` runs the consumer as a separate process: `npm run consume`. Start it before the API on a fresh broker, because it declares the topology.
- RabbitMQ `4.2.9-management` in `docker-compose.yml`, the LTS series; `BROKER_URL` lives in Infisical next to the database connection.

```bash
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

| Demo | My run |
|---|---|
| `demo:publish` | 5 orders placed through `PlaceOrderService`: `published=5 delivered=5 effect=5 acked=5 work=0 dlq=0 prefetch=10` |
| `demo:dlq` | one message that is not an `order.placed` event: `rejected=1 work=0 dlq=1 dlq-reason=rejected effect=0`, the reason is read from the `x-first-death-reason` header |
| `demo:duplicate` | consumer killed with `SIGKILL` after the effect and before the ack, a second consumer receives the redelivery: `deliveries=2 effect=1 skipped=1` |

Every demo resets its own state first: the demo buyer and product are upserted, their orders and receipts from earlier runs are deleted, both queues are purged. Each demo checks its invariant and exits with code 1 when it is violated.

**prefetch = 10.** The effect is one `INSERT` of a few milliseconds, so `10 × 5 ms = 50 ms` is far below the stock `consumer_timeout` of 30 minutes, while 10 is small enough that a second consumer still gets its share of the queue; `prefetch = 1` would cost a broker round trip per message for a 5 ms job.

**At-least-once, not exactly-once.** RabbitMQ delivers at least once: a consumer that dies between the effect and the ack gets the same message again, `demo:duplicate` shows this with `deliveries=2`. The delivery itself is never exactly-once, nothing can make it so. What makes the result happen once is the idempotent effect: the receipt is inserted by a natural key, the `eventId`, with `ON CONFLICT DO NOTHING`, so the second delivery inserts nothing and is acked as a duplicate. The dedup store is the `receipts` table, not process memory, so it survives a restart and is shared by every consumer instance. The duplicate is produced by `kill -9` of a child consumer process whose ack is delayed by `CONSUMER_ACK_DELAY_MS`, which is how a crash looks to the broker: the connection drops and the unacked message is requeued.

**Producer gap.** Before the outbox the event was published after `COMMIT`, and a crash between the two left an order without an event. The outbox below closes this gap.

**DLQ.** `x-dead-letter-exchange` is set as a queue argument of `shop.order-placed`; a poison message is rejected with `requeue=false` and arrives in `shop.dlq` with `x-first-death-reason: rejected`, a message that keeps failing arrives with `delivery_limit` after the third delivery. The dead-letter strategy is the default `at-most-once`: `at-least-once` needs `overflow: reject-publish` on the source queue and silently falls back otherwise.

## Outbox та ідемпотентність

The checkout transaction writes the order and the `outbox` row in one `COMMIT`. The relay `npm run relay` selects unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes each with `messageId` equal to the outbox id and then sets `published_at`. The consumer writes the `processed_messages` mark and the receipt in one transaction: the inbox stops a repeated `messageId`, and `receipts.order_id` with `ON CONFLICT DO NOTHING` stops the same order under a new one. `Idempotency-Key` is stored in `orders` with a unique index on `user_id, idempotency_key`; a concurrent second request gets `23505` and returns the existing order.

| Demo | My run |
|---|---|
| `demo:outbox` | `requests=2 replays=1 orders=1 outbox=1 published=1 deliveries=1 effect=1 processed=1` |
| `demo:crash-write` | `write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0` |
| `demo:crash-relay` | `crashes=1 published=1 deliveries=2 applied=1 duplicates=1 effect=1 processed=1` |

**Crash method.** A modelled crash: an exception thrown by the hook `afterOutboxWrite` in checkout and by the hook `afterPublish` in the relay, between the publish and `UPDATE published_at`. The exception rolls back the open transaction, which is what Postgres does when the process is killed.

**Why publish and `UPDATE published_at` cannot swap.** If the row is marked first and the process dies before the publish, the row is marked as published but the broker never got it, nothing retries it, and the event is lost. In the order publish then `UPDATE` the same crash leaves the row unmarked and the next pass publishes it again. The choice is between a duplicate and a loss: the idempotent consumer removes the duplicate, nothing repairs the loss.

**Outbox cleanup.** `npm run relay` calls `cleanupOutbox` once an hour: it deletes rows with `published_at` older than 7 days in batches of 1000; unpublished rows are never deleted.

**Relay failures.** Each row is published and marked in its own transaction, so a crash keeps the rows already marked. A row the broker returns as unroutable gets `attempts + 1` and is skipped until the next pass, so it does not block the rows behind it; after 10 attempts the relay stops picking it up until `attempts` is reset. Any other publish error is a broker failure: the relay stops without spending an attempt.

## Redis: кеш, сесії, ліміти, черга

Two instances: the cache `redis-cache` needs `allkeys-lru` with `maxmemory`, BullMQ needs `noeviction`, and one process has one `maxmemory-policy`; the queue instance `redis-queue` also runs AOF `everysec`.

Sessions are stored in `redis-queue`, because `allkeys-lru` in the cache instance would evict an active session.

`POST /sessions` with `X-Session-Token` stays the demonstration of Redis sessions with a rolling TTL: it trusts `user_id` from the body and grants no access to orders or products, which require the access token, see [Auth](#auth).

Rate limit is a sliding window, because bursts are not allowed: a fixed window lets 2 × limit through at the window edge. The limit is counted per client IP; a header such as `X-User-Id` is not trusted, because a client could send a new value with every request.

| Demo | My run |
|---|---|
| `demo:cache` | `cache-lru=1 cache-maxmemory=1 warmed=50 ttl-distinct=32 concurrent=50 db-calls=1 db-calls-warm=0` |
| `demo:session` | `requests=3 sessions=1 in-redis=1 ttl-renewed=1` |
| `demo:ratelimit` | `instances=2 limit=10 requests=20 allowed=10 blocked=10 status=429 retry-after=1` |
| `demo:queue` | `queue-noeviction=1 attempts=3 completed=1 added=2 queued=1 schedulers=1 scheduled-runs=2` |

**If the stampede lock breaks**, for example its TTL expires while the owner is paused, two readers load the same product card from the database and both write the same value to the cache. The cost is one extra read; no state is corrupted, because the card is derived data and the database stays the source of truth.

## Auth

| Змінна | Джерело | Навіщо |
|---|---|---|
| `JWT_PRIVATE_KEY` | сховище (#11) | ES256 private key, PKCS#8 PEM in base64, signs access tokens |
| `JWT_PUBLIC_KEY` | сховище (#11) | ES256 public key, SPKI PEM in base64, verifies access tokens |
| `JWT_KID` | сховище (#11) | key id written into the token header |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | HMAC key for `refresh_tokens.token_hash`, at least 32 characters |
| `JWT_PREVIOUS_KID` | сховище (#11), only during a key rotation | `kid` of the retired key whose tokens are still accepted |
| `JWT_PREVIOUS_PUBLIC_KEY` | сховище (#11), only during a key rotation | public key of the retired pair, SPKI PEM in base64 |

The schema in `src/config/env.schema.ts` has no defaults for the first four variables and checks that the keys parse as P-256 keys. The two `JWT_PREVIOUS_*` variables are optional, come together or not at all, and the previous `kid` must differ from `JWT_KID`. `ConfigModule` validates the environment while the modules load, before the database pool is created, so a bare `npm run start` without them exits with code 1 and names the missing variable.

| Endpoint | Result |
|---|---|
| `POST /auth/login` | email and password ──► `200` with an access and a refresh token, a new token family |
| `POST /auth/refresh` | refresh token ──► `200` with a new pair; the presented token is spent |
| `POST /auth/logout` | access token ──► `204`; the family and the access token are revoked |
| `GET /auth/me` | access token ──► `200` with `id` and `role` |

**Tokens.** The access token is an ES256 JWT for 10 minutes with `sub`, `role`, `sid` (the token family), `jti`, `iss` and `aud`. The refresh token is 32 random bytes in base64url for 7 days; the table `refresh_tokens` keeps only `HMAC-SHA256(token, REFRESH_TOKEN_PEPPER)`, so a dump of the table holds no usable session. Passwords are hashed with scrypt from `node:crypto`.

**Why ES256.** OWASP marks RS256 as not recommended; ES256 gives the same asymmetric split with a 256-bit key and a short signature. Verification pins `algorithms: ['ES256']` together with `iss` and `aud` (RFC 8725 §3.1), so `alg: none` and an HS256 token signed with the public key are rejected.

**Rotation with reuse detection.** One refresh is one transaction: `UPDATE refresh_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND NOT EXISTS (a revoked row in the same family)` and the insert of the next token into the same `family_id`. The family condition covers a refresh that races a logout: the logout `UPDATE` does not see the row inserted by the concurrent refresh, but that row belongs to a family with a revoked row and can never be refreshed. When a spent token comes back, the whole family gets `revoked_at` in the same transaction, the log gets `refresh token reuse detected: user=… family=…`, and `auth:revoked-sid:<family>` goes to the denylist, so the access tokens already issued to the thief and to the honest client stop working too; both get `401`. The revocation is committed in Postgres before Redis is touched, so a failed Redis write loses nothing: `refresh_tokens.revoked_at` is the outbox. The denylist marks itself out of sync on a failed write or a dropped connection, and the guard answers `503` until `AuthMaintenance` has copied every family revoked in the last 600 seconds into Redis; the copy runs on start, on every Redis reconnect and every 5 seconds, and uses the partial index `refresh_tokens_revoked_at_idx`. This is rotation with detection from RFC 9700 §4.14.2, and `family_id` is the link that makes the revocation possible. A refresh does not see the previous access token, so that token stays valid until its `exp`, at most 10 minutes. Two parallel refreshes with one token look like a reuse, so the client serializes refresh behind one shared promise; there is no grace window, because a grace window would answer `200` to a replayed token.

**Why logout is two actions.** The refresh token is a row in Postgres, so it is enough to set `revoked_at` on its family. The access token is self-contained and stays valid until `exp`, so its `jti` goes to the denylist in `redis-queue` with TTL = `exp − now`. The same `MULTI` writes `auth:revoked-sid:<sid>` for 600 seconds, the longest access token lifetime, because the session may hold an older access token issued before the last refresh; the guard checks both keys with one `EXISTS`. Postgres and Redis are two stores and the writes are not atomic: logout writes Postgres first and Redis second, and any failure answers `503`; a repeated logout is safe, because the family update matches nothing and the denylist write is retried. If the client never repeats it, the revoked family in Postgres still reaches the denylist through the same `AuthMaintenance` copy. The denylist lives in `redis-queue` because `noeviction` never drops a key, while `allkeys-lru` in the cache would bring a revoked token back to life. When Redis is unavailable the guard answers `503` instead of letting the token through.

**401 and 403.** No token, a malformed, expired, tampered or revoked token is `401`. A valid token without the right is `403`: a buyer on `POST /products` or `PATCH /orders/{id}/status`, a buyer reading another buyer's order.

**Where the ownership check lives.** `AuthGuard` establishes who the caller is and `RolesGuard` checks the role from the token, both before the controller. Ownership needs the order itself, which a guard does not have, so `OrdersController` loads the order once and compares `order.userId` with the token subject; the SSE stream and the socket.io `join` compare the owner from `findOwnerId` in the same way. Both check the token again before every event: after logout, after a reuse revoked the family or after `exp`, the SSE response ends and the socket is disconnected instead of receiving the next event. The SSE stream also ends at `exp` on its own, so the client reconnects with a fresh token.

**Role in the token is a cache.** A demoted admin or seller keeps the old role until the access token expires, at most 10 minutes; the next refresh reads the role from the database. To cut it sooner, set `revoked_at` on the user's token families and put their `sid` into the denylist.

**Key rotation and `kid`.** Every token carries `kid` in its header, and `TokenService` picks the public key by that `kid` from the map built in `src/auth/verification-keys.ts`; a token with an unknown `kid` is `401`. An overlap rotation takes three deploys without dropping a session:

1. Generate a new pair and keep the old public key and its `kid`.
2. Put the new pair into `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` and `JWT_KID`, and the old values into `JWT_PREVIOUS_KID` and `JWT_PREVIOUS_PUBLIC_KEY`. New tokens are signed with the new key, and tokens issued before the deploy are still accepted.
3. After 10 minutes, the access token lifetime, remove both `JWT_PREVIOUS_*` variables.

Refresh tokens do not depend on the signing key, so a rotation never logs anyone out.

**Cleanup of `refresh_tokens`.** Every rotation adds a row, so `AuthMaintenance` deletes expired rows once an hour in batches of 1000, using `refresh_tokens_expires_at_idx`. It deletes a row only when every row of its family has expired. A spent row of a live family has to stay, because the reuse check finds the family through it.

| Environment | `JWT_KID` | Public key fingerprint, SHA-256 of SPKI DER, first 16 hex |
|---|---|---|
| dev | `dev-2026-11` | `22eb8c121798916d` |
| prod | `prod-2026-11` | `0c36e52fa6f24f78` |

```bash
bash scripts/with-secrets.sh dev node -e 'const c=require("node:crypto");const pub=c.createPublicKey(Buffer.from(process.env.JWT_PUBLIC_KEY,"base64").toString());console.log(c.createHash("sha256").update(pub.export({type:"spki",format:"der"})).digest("hex").slice(0,16))'
```

**Domain.** `orders` is the resource with an owner, `products` is the resource only a `seller` or an `admin` writes. Seed users have the password `marketplace-dev`; `taras.oliinyk@outlook.com` is the seller. The demos create their own users `auth-demo-*@example.com` and remove their tokens and orders on every run.

| Demo | My run |
|---|---|
| `demo:auth` | `login=200 no-token=401 with-token=200 refresh=200 logout=204 after-logout=401 refresh-after-logout=401 old-access-after-logout=401` |
| `demo:reuse` | `login=200 r1-refresh=200 r1-reuse=401 r2-after-reuse=401 access-after-reuse=401 family-tokens=2 family-revoked=2` |
| `demo:rbac` | `anon=401 own=200 foreign=403 role-denied=403 role-allowed=201 tampered=401` |

## Grading

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=app_user DB_PASSWORD=first-pass DB_NAME=marketplace
export DATABASE_URL=postgres://app_user:first-pass@127.0.0.1:6432/marketplace
export BROKER_URL=amqp://app_user:first-pass@127.0.0.1:5672
export REDIS_URL=redis://127.0.0.1:6390
export REDIS_QUEUE_URL=redis://127.0.0.1:6391
export PORT=5001
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER="$(openssl rand -base64 32)"
npm ci
npm run build
npm run migrate
npm run seed
npm run demo:race
npm run demo:workers
npm run demo:retry
npm run demo:publish; echo "exit=$?"
npm run demo:dlq; echo "exit=$?"
npm run demo:duplicate; echo "exit=$?"
npm run demo:outbox; echo "exit=$?"
npm run demo:crash-write; echo "exit=$?"
npm run demo:crash-relay; echo "exit=$?"
npm run demo:cache; echo "exit=$?"
npm run demo:session; echo "exit=$?"
npm run demo:ratelimit; echo "exit=$?"
npm run demo:queue; echo "exit=$?"
npm run demo:auth; echo "exit=$?"
npm run demo:reuse; echo "exit=$?"
npm run demo:rbac; echo "exit=$?"
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
PORT=3000 node dist/src/server.js &
SERVER_PID=$!
until curl -sf http://localhost:3000/health > /dev/null; do sleep 1; done
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
login() { curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"marketplace-dev\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token"; }
BUYER=$(login olena.shevchenko@gmail.com)
SELLER=$(login taras.oliinyk@outlook.com)
ORDER_ID=$(curl -s -H "Authorization: Bearer $BUYER" 'http://localhost:3000/orders?limit=100' | node -pe "JSON.parse(require('fs').readFileSync(0)).items.find((order) => order.status !== 'cancelled').id")
curl -sN --max-time 2 -D - -o /dev/null -H "Authorization: Bearer $BUYER" http://localhost:3000/orders/$ORDER_ID/events | grep -i '^content-type'
curl -sN --max-time 5 -H "Authorization: Bearer $BUYER" http://localhost:3000/orders/$ORDER_ID/events &
STREAM_PID=$!
sleep 1
for STATUS in pending paid pending paid pending; do curl -s -o /dev/null -X PATCH http://localhost:3000/orders/$ORDER_ID/status -H 'Content-Type: application/json' -H "Authorization: Bearer $SELLER" -d "{\"status\":\"$STATUS\"}"; done
wait $STREAM_PID
curl -sN --max-time 2 -H "Authorization: Bearer $BUYER" -H 'Last-Event-ID: 3' http://localhost:3000/orders/$ORDER_ID/events | grep '^id:' | head -1
kill $SERVER_PID
```
