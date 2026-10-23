import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_STATE } from '../redis/redis'

export type RateLimitResult = {
    allowed: boolean
    retryAfterSeconds: number
}

export const RATE_LIMIT = 10

export const RATE_LIMIT_WINDOW_MS = 10_000

export const rateLimitKey = (client: string): string => `rate-limit:${client}`

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

if redis.call('ZCARD', key) < limit then
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)
    return {1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')

return {0, tonumber(oldest[2]) + window - now}
`

@Injectable()
export class RateLimiterService {
    constructor(@Inject(REDIS_STATE) private readonly redis: Redis) {}

    async hit(client: string): Promise<RateLimitResult> {
        try {
            const [allowed, retryAfterMs] = (await this.redis.eval(
                SLIDING_WINDOW_SCRIPT,
                1,
                rateLimitKey(client),
                RATE_LIMIT_WINDOW_MS,
                RATE_LIMIT,
                randomUUID(),
            )) as [number, number]

            return {
                allowed: allowed === 1,
                retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
            }
        } catch {
            return { allowed: true, retryAfterSeconds: 0 }
        }
    }
}