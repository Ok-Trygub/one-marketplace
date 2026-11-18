import { setTimeout as sleep } from 'node:timers/promises'
import { finish, login, newTraceparent, parseLog, prepareDemoUsers, randomHex, request, run, startServer } from './observability-support.mjs'

const OUT_OF_RANGE_ID = '99999999999999999999'
const tagOf = (span, key) => span.tags?.find((tag) => tag.key === key)?.value

const fetchTrace = async (traceId) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const body = await fetch(`${process.env.TRACE_API_URL}/api/traces/${traceId}`)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
        const trace = body?.data?.[0]

        if (trace?.spans?.some((span) => tagOf(span, 'span.kind') === 'server')) {
            return trace
        }

        await sleep(1000)
    }

    return { spans: [] }
}

run(async () => {
    if (!process.env.TRACE_API_URL) {
        throw new Error('TRACE_API_URL is not set')
    }

    const { users, password } = await prepareDemoUsers()
    const server = await startServer()
    const traceparent = newTraceparent()
    const tenant = `trace-demo-${randomHex(4)}`
    let status

    try {
        const token = await login(users.owner.email, password)

        status = (await request(`/orders/${OUT_OF_RANGE_ID}`, { token, headers: { traceparent: traceparent.header, 'X-Tenant': tenant } })).status
    } finally {
        await server.stop()
    }

    const trace = await fetchTrace(traceparent.traceId)
    const spanIds = new Set(trace.spans.map((span) => span.spanID))
    const orphans = trace.spans.filter((span) =>
        (span.references ?? []).some((reference) => !spanIds.has(reference.spanID) && reference.spanID !== traceparent.parentId),
    ).length
    const serverSpan = trace.spans.find((span) => tagOf(span, 'span.kind') === 'server')
    const logTraceIds = new Set(parseLog(server.lines).entries.filter((entry) => entry?.tenant === tenant).map((entry) => entry.trace_id))
    const spanTraceId = trace.spans[0]?.traceID

    finish(
        {
            status,
            spans: trace.spans.length,
            'orphan-spans': orphans,
            'trace-matches-header': spanTraceId === traceparent.traceId ? 1 : 0,
            'trace-matches-log': logTraceIds.size === 1 && logTraceIds.has(spanTraceId) ? 1 : 0,
            'span-status-error': serverSpan && tagOf(serverSpan, 'otel.status_code') === 'ERROR' ? 1 : 0,
        },
        [
            ['status=5xx', status >= 500],
            ['spans>=2', trace.spans.length >= 2],
            ['orphan-spans=0', orphans === 0],
            ['trace-matches-header=1', spanTraceId === traceparent.traceId],
            ['trace-matches-log=1', logTraceIds.size === 1 && logTraceIds.has(spanTraceId)],
            ['span-status-error=1', Boolean(serverSpan) && tagOf(serverSpan, 'otel.status_code') === 'ERROR'],
        ],
    )
})
