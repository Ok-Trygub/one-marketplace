import { trace } from '@opentelemetry/api'
import type { LoggerService } from '@nestjs/common'
import pino from 'pino'
import { requestContext } from './context'

export const REDACTED_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-session-token"]',
    'req.body.password',
    'req.body.refresh_token',
    'password',
    'refresh_token',
    'access_token',
    '*.password',
    '*.refresh_token',
    '*.access_token',
]

export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'marketplace-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    mixin() {
        const span = trace.getActiveSpan()
        const context = requestContext.getStore() ?? {}

        return span ? { ...context, trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId } : { ...context }
    },
})

export const layerLogger = (layer: string): pino.Logger => logger.child({ layer })

const nest = layerLogger('nest')

export const nestLogger: LoggerService = {
    log: (message: unknown, context?: string) => nest.info({ context }, String(message)),
    error: (message: unknown, trace?: string, context?: string) => nest.error({ context, stack: trace }, String(message)),
    warn: (message: unknown, context?: string) => nest.warn({ context }, String(message)),
    debug: (message: unknown, context?: string) => nest.debug({ context }, String(message)),
    verbose: (message: unknown, context?: string) => nest.trace({ context }, String(message)),
}
