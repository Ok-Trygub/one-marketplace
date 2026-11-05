import { Inject, Injectable } from '@nestjs/common'
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { DataSource } from 'typeorm'
import { RefreshToken } from '../entities/refresh-token.entity'
import { REDIS_STATE } from '../redis/redis'
import { AccessDenylist } from './access-denylist'
import type { RevokedSession } from './access-denylist'
import {
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKENS_CLEANUP_BATCH,
    REFRESH_TOKENS_CLEANUP_INTERVAL_MS,
    REVOKED_SESSIONS_SYNC_INTERVAL_MS,
} from './auth.constants'

export const findRecentlyRevokedSessions = async (dataSource: DataSource): Promise<RevokedSession[]> => {
    const rows = await dataSource.query<{ family_id: string; ttl_seconds: number }[]>(
        `SELECT family_id,
                ceil(extract(epoch FROM max(revoked_at) + make_interval(secs => $1) - now()))::int AS ttl_seconds
         FROM refresh_tokens
         WHERE revoked_at > now() - make_interval(secs => $1)
         GROUP BY family_id`,
        [ACCESS_TOKEN_TTL_SECONDS],
    )

    return rows.map((row) => ({ sessionId: row.family_id, ttlSeconds: row.ttl_seconds }))
}

export const cleanupExpiredRefreshTokens = async (
    dataSource: DataSource,
    batchSize: number = REFRESH_TOKENS_CLEANUP_BATCH,
): Promise<number> => {
    let deleted = 0

    while (true) {
        const result = await dataSource
            .createQueryBuilder()
            .delete()
            .from(RefreshToken)
            .where(
                `id IN (
                    SELECT expired.id FROM refresh_tokens expired
                    WHERE expired.expires_at < now()
                      AND NOT EXISTS (
                          SELECT 1 FROM refresh_tokens live
                          WHERE live.family_id = expired.family_id AND live.expires_at >= now()
                      )
                    LIMIT :limit
                )`,
                { limit: batchSize },
            )
            .execute()
        const affected = result.affected ?? 0

        deleted += affected

        if (affected < batchSize) {
            return deleted
        }
    }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

@Injectable()
export class AuthMaintenance implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly timers: NodeJS.Timeout[] = []
    private readonly running = new Map<string, Promise<void>>()
    private stopped = false

    constructor(
        private readonly dataSource: DataSource,
        private readonly denylist: AccessDenylist,
        @Inject(REDIS_STATE) private readonly redis: Redis,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.redis.on('ready', () => this.launch('revoked sessions sync', () => this.syncRevokedSessions()))

        await this.launch('revoked sessions sync', () => this.syncRevokedSessions())
        this.launch('refresh tokens cleanup', () => this.cleanupRefreshTokens())

        this.every(REVOKED_SESSIONS_SYNC_INTERVAL_MS, 'revoked sessions sync', () => this.syncRevokedSessions())
        this.every(REFRESH_TOKENS_CLEANUP_INTERVAL_MS, 'refresh tokens cleanup', () => this.cleanupRefreshTokens())
    }

    async onModuleDestroy(): Promise<void> {
        this.stopped = true

        for (const timer of this.timers) {
            clearInterval(timer)
        }

        await Promise.all(this.running.values())
    }

    private async syncRevokedSessions(): Promise<void> {
        const since = this.denylist.syncPoint()
        const sessions = await findRecentlyRevokedSessions(this.dataSource)

        await this.denylist.restoreRevokedSessions(sessions, since)
    }

    private async cleanupRefreshTokens(): Promise<void> {
        const deleted = await cleanupExpiredRefreshTokens(this.dataSource)

        if (deleted > 0) {
            console.log(`auth: deleted ${deleted} refresh tokens of expired families`)
        }
    }

    private every(intervalMs: number, name: string, task: () => Promise<void>): void {
        this.timers.push(setInterval(() => this.launch(name, task), intervalMs).unref())
    }

    private launch(name: string, task: () => Promise<void>): Promise<void> {
        const current = this.running.get(name)

        if (current || this.stopped) {
            return current ?? Promise.resolve()
        }

        const run = task()
            .catch((error: unknown) => {
                if (!this.stopped) {
                    console.warn(`auth: ${name} failed: ${describe(error)}`)
                }
            })
            .finally(() => this.running.delete(name))

        this.running.set(name, run)

        return run
    }
}
