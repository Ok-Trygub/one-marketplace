## Configuration

### Environment variables

Application configuration is validated on startup using Zod through NestJS `ConfigModule`.

```env
PORT=5001
DB_URL=postgres://app_user:initial_password@localhost:5432/marketplace
LOG_LEVEL=info
TIMEOUT_MS=5000
```

`PORT` and `DB_URL` are required.

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

Build and start the application:

```bash
npm run build
npm run start
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
  "database": true
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

The application process is not restarted.

After rotation, verify the database connection:

```bash
curl http://localhost:5001/health
```

The expected response remains:

```json
{
  "status": "ok",
  "database": true
}
```

### Infisical

Infisical is used as the external secret-management option for the additional challenge.

The application must not store the database password in source code, Dockerfile, Docker image environment variables, or Git-tracked files.

The secret should be provided to the application through the secret-management system instead of committing it to the repository.

The local file-based secret mechanism remains available for the required password-rotation test:

```text
secrets/db_password
```

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
