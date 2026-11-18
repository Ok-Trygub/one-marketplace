import { Counter, Histogram, Registry } from 'prom-client'

export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]

export const metricsRegistry = new Registry()

export const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by method, route template and status code',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [metricsRegistry],
})

export const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by method, route template and status code',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: DURATION_BUCKETS,
    registers: [metricsRegistry],
})
