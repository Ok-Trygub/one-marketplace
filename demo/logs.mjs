import { finish, login, newTraceparent, parseLog, prepareDemoUsers, randomHex, request, run, startServer } from './observability-support.mjs'

const BURST = 8

run(async () => {
    const { users, password, productName } = await prepareDemoUsers()
    const server = await startServer()
    const runId = randomHex(4)
    const single = newTraceparent()
    const singleKey = `logs-demo-${runId}`
    const burst = Array.from({ length: BURST }, () => newTraceparent())
    const tokenMarker = `tokenmarker${randomHex(6)}`
    const passwordMarker = `passmarker${randomHex(6)}`

    try {
        const buyer = await login(users.owner.email, password)
        const seller = await login(users.seller.email, password)
        const product = await request('/products', {
            method: 'POST',
            token: seller,
            headers: { 'Idempotency-Key': `logs-product-${runId}` },
            body: { name: productName, price_cents: 100, stock: 1000 },
        })
        const placeOrder = (traceparent, idempotencyKey) =>
            request('/orders', {
                method: 'POST',
                token: buyer,
                headers: { traceparent, 'Idempotency-Key': idempotencyKey },
                body: { items: [{ product_id: String(product.body.id), quantity: 1 }] },
            })

        await placeOrder(single.header, singleKey)
        await Promise.all(burst.map((trace, index) => placeOrder(trace.header, `logs-burst-${runId}-${index}`)))
        await request('/auth/login', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenMarker}` },
            body: { email: users.owner.email, password: passwordMarker },
        })
    } finally {
        await server.stop()
    }

    const { entries, nonJson } = parseLog(server.lines)
    const singleLines = entries.filter((entry) => entry?.idempotencyKey === singleKey)
    const singleTraceIds = new Set(singleLines.map((entry) => entry.trace_id))
    const groups = burst.map((trace) => entries.filter((entry) => entry?.trace_id === trace.traceId).length)
    const burstTraceIds = groups.filter((size) => size > 0).length
    const burstUneven = groups.filter((size) => size !== groups[0]).length

    finish(
        {
            'non-json-lines': nonJson,
            layers: new Set(singleLines.map((entry) => entry.layer)).size,
            'distinct-trace-ids': singleTraceIds.size,
            'trace-id-matches-header': singleTraceIds.size === 1 && singleTraceIds.has(single.traceId) ? 1 : 0,
            burst: BURST,
            'burst-trace-ids': burstTraceIds,
            'burst-uneven': burstUneven,
            'secret-req-logged': entries.some((entry) => entry?.req?.url === '/auth/login') ? 1 : 0,
            'secret-in-logs': server.lines.filter((line) => line.includes(tokenMarker) || line.includes(passwordMarker)).length,
        },
        [
            ['non-json-lines=0', nonJson === 0],
            ['layers>=3', new Set(singleLines.map((entry) => entry.layer)).size >= 3],
            ['distinct-trace-ids=1', singleTraceIds.size === 1],
            ['trace-id-matches-header=1', singleTraceIds.has(single.traceId)],
            ['burst-trace-ids=burst', burstTraceIds === BURST],
            ['burst-uneven=0', burstUneven === 0],
            ['secret-req-logged=1', entries.some((entry) => entry?.req?.url === '/auth/login')],
            ['secret-in-logs=0', !server.lines.some((line) => line.includes(tokenMarker) || line.includes(passwordMarker))],
        ],
    )
})
