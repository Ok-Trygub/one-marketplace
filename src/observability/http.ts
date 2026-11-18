import { AsyncResource } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'
import { requestContext } from './context'
import { layerLogger } from './logger'
import { httpDuration, httpRequests, metricsRegistry } from './metrics'

const http = layerLogger('http')

const routeOf = (request: Request): string =>
    request.route?.path ? `${request.baseUrl}${String(request.route.path)}` : 'unmatched'

export const withRequestContext = (request: Request, _response: Response, next: NextFunction): void => {
    const idempotencyKey = request.header('idempotency-key')

    requestContext.run({ tenant: request.header('x-tenant') ?? 'default', ...(idempotencyKey ? { idempotencyKey } : {}) }, next)
}

export const observeRequest = (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/metrics') {
        next()
        return
    }

    const started = process.hrtime.bigint()

    response.on(
        'finish',
        AsyncResource.bind(() => {
            const seconds = Number(process.hrtime.bigint() - started) / 1e9
            const labels = { method: request.method, route: routeOf(request), status: String(response.statusCode) }

            httpRequests.inc(labels)
            httpDuration.observe(labels, seconds)
            http.info(
                {
                    req: { method: request.method, url: request.originalUrl, headers: { authorization: request.header('authorization') } },
                    res: { statusCode: response.statusCode },
                    route: labels.route,
                    duration_ms: Math.round(seconds * 1000),
                },
                'request completed',
            )
        }),
    )

    next()
}

export const metricsEndpoint = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (request.method !== 'GET') {
        next()
        return
    }

    response.setHeader('Content-Type', metricsRegistry.contentType)
    response.end(await metricsRegistry.metrics())
}
