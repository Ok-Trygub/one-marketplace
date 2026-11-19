import type { Request } from 'express'

export const UNMATCHED_ROUTE = 'unmatched'

export const routeOf = (request: Pick<Request, 'baseUrl' | 'route'>): string =>
    request.route?.path ? `${request.baseUrl}${String(request.route.path)}` : UNMATCHED_ROUTE
