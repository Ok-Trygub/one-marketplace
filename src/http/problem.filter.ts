import { Catch, HttpException, HttpStatus } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'

export type Problem = {
    type: string
    title: string
    status: number
    detail: string
    instance: string
}

export const PROBLEM_TYPE = 'https://api.one-marketplace.com/problems/http-error'

export const sendProblem = (
    response: Response,
    request: Request,
    status: number,
    title: string,
    detail: string,
): void => {
    const problem: Problem = {
        type: PROBLEM_TYPE,
        title,
        status,
        detail,
        instance: request.originalUrl,
    }

    response.status(status).type('application/problem+json').json(problem)
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const context = host.switchToHttp()
        const response = context.getResponse<Response>()
        const request = context.getRequest<Request>()

        if (exception instanceof HttpException) {
            const body = exception.getResponse()
            const detail =
                typeof body === 'string'
                    ? body
                    : (body as { message?: string | string[] }).message ?? exception.message

            sendProblem(
                response,
                request,
                exception.getStatus(),
                exception.name,
                Array.isArray(detail) ? detail.join('; ') : String(detail),
            )

            return
        }

        console.error(exception)

        sendProblem(
            response,
            request,
            HttpStatus.INTERNAL_SERVER_ERROR,
            'InternalServerError',
            'Unexpected server error',
        )
    }
}
