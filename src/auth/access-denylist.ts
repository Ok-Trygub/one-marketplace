import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_STATE } from '../redis/redis'
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants'

export const deniedTokenKey = (tokenId: string): string => `auth:denied-jti:${tokenId}`

export const revokedSessionKey = (sessionId: string): string => `auth:revoked-sid:${sessionId}`

@Injectable()
export class AccessDenylist {
    constructor(@Inject(REDIS_STATE) private readonly redis: Redis) {}

    async logout(tokenId: string, expiresAt: number, sessionId: string): Promise<void> {
        const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000)
        const transaction = this.redis.multi().set(revokedSessionKey(sessionId), '1', 'EX', ACCESS_TOKEN_TTL_SECONDS)

        if (ttlSeconds > 0) {
            transaction.set(deniedTokenKey(tokenId), '1', 'EX', ttlSeconds)
        }

        const results = await transaction.exec()
        const failure = results?.find(([error]) => error)?.[0]

        if (!results || failure) {
            throw failure ?? new Error('denylist transaction was discarded')
        }
    }

    async revokeSession(sessionId: string): Promise<void> {
        await this.redis.set(revokedSessionKey(sessionId), '1', 'EX', ACCESS_TOKEN_TTL_SECONDS)
    }

    async isDenied(tokenId: string, sessionId: string): Promise<boolean> {
        return (await this.redis.exists(deniedTokenKey(tokenId), revokedSessionKey(sessionId))) > 0
    }
}
