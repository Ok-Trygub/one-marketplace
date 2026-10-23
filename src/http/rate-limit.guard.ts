import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import type { Request, Response } from 'express'
import { RateLimiterService } from '../services/rate-limiter.service'

@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(private readonly limiter: RateLimiterService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const http = context.switchToHttp()
        const request = http.getRequest<Request>()
        const response = http.getResponse<Response>()
        const client = request.header('x-user-id') ?? request.ip ?? 'unknown'
        const result = await this.limiter.hit(client)

        if (result.allowed) {
            return true
        }

        response.set('Retry-After', String(result.retryAfterSeconds))

        throw new HttpException('Rate limit exceeded, retry later', HttpStatus.TOO_MANY_REQUESTS)
    }
}