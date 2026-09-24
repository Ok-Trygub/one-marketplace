import path from 'node:path'
import { json } from 'express'
import type { NextFunction, Request, Response } from 'express'
import * as OpenApiValidator from 'express-openapi-validator'
import type { INestApplication } from '@nestjs/common'
import { ProblemExceptionFilter, sendProblem } from './problem.filter'

type ValidationFailure = Error & { status?: number }

export const OPENAPI_SPEC = path.join(process.cwd(), 'openapi/openapi.yaml')

export const configureApp = (app: INestApplication): INestApplication => {
    app.use(json())

    app.use(
        OpenApiValidator.middleware({
            apiSpec: OPENAPI_SPEC,
            validateRequests: true,
            validateResponses: false,
            ignorePaths: /^\/health$/,
        }),
    )

    app.use((error: ValidationFailure, request: Request, response: Response, next: NextFunction) => {
        if (!error.status) {
            next(error)

            return
        }

        sendProblem(response, request, error.status, error.name || 'Error', error.message)
    })

    app.useGlobalFilters(new ProblemExceptionFilter())

    return app
}
