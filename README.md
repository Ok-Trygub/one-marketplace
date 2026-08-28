# One Marketplace API

REST API for a marketplace application built with Node.js, Express and TypeScript.

## API

* `GET /products` — list products
* `POST /products` — create a product
* `GET /orders` — list orders
* `POST /orders` — create an order
* `GET /orders/{id}` — get an order by ID

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

## Verify

Start the server first, then run the checks below.

Request without `Idempotency-Key` — expected `400` with `application/problem+json`:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":"laptop","quantity":1}]}'
```

Request with an invalid body — expected `400` with the detail from the validator:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-key-1' \
  -d '{"items":[]}'
```

Valid request — expected `201`:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-key-1' \
  -d '{"items":[{"product_id":"laptop","quantity":1}]}'
```

Repeat the valid request with the same key and the same body — expected `201` with the `Idempotency-Replay: true` header and the same order.

Repeat it with the same key and a different body — expected `422` with `application/problem+json`:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-key-1' \
  -d '{"items":[{"product_id":"phone","quantity":3}]}'
```

Check the number of operations and resources in the specification:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));console.log('operations:',ops.length,'resources:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);console.log('Idempotency-Key required =',idem?.required)"
```

