## Configuration

### Environment variables

Application configuration is validated on startup using Zod through NestJS `ConfigModule`.

```env
PORT=5001
DB_URL=postgres://app_user:initial_password@localhost:5432/marketplace
LOG_LEVEL=info
TIMEOUT_MS=5000
```

`PORT` and `DB_URL` are required. `DB_URL` provides the host, port, database and user; the password comes from the secret file. Use `localhost` when running on the host and `postgres` when running through Compose.

`LOG_LEVEL` accepts only:

* `debug`
* `info`
* `warn`
* `error`

Default: `info`.

`TIMEOUT_MS` must be a positive integer.

Default: `5000`.

Invalid configuration causes the application to fail during startup.

The repository contains `.env.example` as the configuration contract. The real `.env` file is not committed.

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

The `secrets/` directory is excluded from Git and Docker build context.

### Application

Start the application together with PostgreSQL:

```bash
docker compose up -d --build
```

The application connects to PostgreSQL over the Docker network, so it runs inside Compose rather than on the host.

If the container starts with an outdated `node_modules`, renew the anonymous volume:

```bash
docker compose up -d --build --renew-anon-volumes api
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
