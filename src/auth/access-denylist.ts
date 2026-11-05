import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_STATE } from '../redis/redis'
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants'

export type RevokedSession = {
    sessionId: string
    ttlSeconds: number
}

export class DenylistOutOfSyncError extends Error {
    override readonly name = 'DenylistOutOfSyncError'

    constructor() {
        super('denylist has not caught up with the revoked sessions in Postgres yet')
    }
}

const throwOnFailure = (results: [Error | null, unknown][] | null): void => {
    const failure = results?.find(([error]) => error)?.[0]

    if (!results || failure) {
        throw failure ?? new Error('denylist transaction was discarded')
    }
}

export const deniedTokenKey = (tokenId: string): string => `auth:denied-jti:${tokenId}`

export const revokedSessionKey = (sessionId: string): string => `auth:revoked-sid:${sessionId}`

@Injectable()
export class AccessDenylist {
    private synced = false
    private generation = 0

    constructor(@Inject(REDIS_STATE) private readonly redis: Redis) {
        redis.on('close', () => this.markOutOfSync())
    }

    syncPoint(): number {
        return this.generation
    }

    async logout(tokenId: string, expiresAt: number, sessionId: string): Promise<void> {
        const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000)
        const transaction = this.redis.multi().set(revokedSessionKey(sessionId), '1', 'EX', ACCESS_TOKEN_TTL_SECONDS)

        if (ttlSeconds > 0) {
            transaction.set(deniedTokenKey(tokenId), '1', 'EX', ttlSeconds)
        }

        await this.write(async () => throwOnFailure(await transaction.exec()))
    }

    async revokeSession(sessionId: string): Promise<void> {
        await this.write(async () => {
            await this.redis.set(revokedSessionKey(sessionId), '1', 'EX', ACCESS_TOKEN_TTL_SECONDS)
        })
    }

    async restoreRevokedSessions(sessions: RevokedSession[], since: number): Promise<void> {
        if (sessions.length > 0) {
            const pipeline = this.redis.pipeline()

            for (const { sessionId, ttlSeconds } of sessions) {
                pipeline.set(revokedSessionKey(sessionId), '1', 'EX', ttlSeconds, 'NX')
            }

            await this.write(async () => throwOnFailure(await pipeline.exec()))
        }

        if (this.generation === since) {
            this.synced = true
        }
    }

    async isDenied(tokenId: string, sessionId: string): Promise<boolean> {
        if (!this.synced) {
            throw new DenylistOutOfSyncError()
        }

        return (await this.redis.exists(deniedTokenKey(tokenId), revokedSessionKey(sessionId))) > 0
    }

    private markOutOfSync(): void {
        this.synced = false
        this.generation += 1
    }

    private async write(operation: () => Promise<void>): Promise<void> {
        try {
            await operation()
        } catch (error) {
            this.markOutOfSync()
            throw error
        }
    }
}
