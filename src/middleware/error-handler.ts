import { Request, Response, NextFunction } from 'express'

type ApiError = Error & {
    status?: number
    statusCode?: number
    message: string
}

export const errorHandler = (
    err: ApiError,
    req: Request,
    res: Response,
    _next: NextFunction,
) => {
    const status = err.status ?? err.statusCode ?? 500

    res.status(status).type('application/problem+json').json({
        type: 'https://api.one-marketplace.com/problems/http-error',
        title: err.name || 'Error',
        status,
        detail: err.message,
        instance: req.originalUrl,
    })
}
