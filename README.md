# One Marketplace API

REST API for a marketplace application built with Node.js, Express and TypeScript.

## API

* `GET /products` — list products
* `POST /products` — create a product
* `GET /orders` — list orders
* `POST /orders` — create an order
* `GET /orders/{id}` — get an order by ID

## Features

* OpenAPI 3.0.3 specification
* Request and response validation with `express-openapi-validator`
* Centralized error handling with `application/problem+json`
* Idempotency support for `POST /products` and `POST /orders`
* SHA-256 request fingerprinting for idempotency
* `422` response when an idempotency key is reused with a different request body
* Basic pagination structure with `limit`, `cursor` and `next_cursor`
* In-memory data storage

## Run

```bash
npm install
npm run build
npm start
```

Server:

```text
http://localhost:3000
```

## OpenAPI

OpenAPI specification:

```text
openapi/openapi.yaml
```

Bundle the specification:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
```

Lint the specification:

```bash
npx @redocly/cli lint openapi/openapi.yaml
```
