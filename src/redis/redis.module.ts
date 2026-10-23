import { Module } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Redis } from 'ioredis'
import { REDIS_CACHE, REDIS_STATE, connectCache, connectState } from './redis'
import type { Env } from '../config/env.schema'

class RedisLifecycle implements OnModuleDestroy {
    constructor(private readonly connections: Redis[]) {}

    async onModuleDestroy(): Promise<void> {
        await Promise.all(
            this.connections.map(async (connection) => {
                if (connection.status === 'wait') {
                    connection.disconnect()
                    return
                }

                await connection.quit()
            }),
        )
    }
}

@Module({
    providers: [
        {
            provide: REDIS_CACHE,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) =>
                connectCache(process.env.REDIS_URL ?? config.get('REDIS_URL', { infer: true })),
        },
        {
            provide: REDIS_STATE,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) =>
                connectState(
                    process.env.REDIS_QUEUE_URL ?? config.get('REDIS_QUEUE_URL', { infer: true }),
                ),
        },
        {
            provide: RedisLifecycle,
            inject: [REDIS_CACHE, REDIS_STATE],
            useFactory: (cache: Redis, state: Redis) => new RedisLifecycle([cache, state]),
        },
    ],
    exports: [REDIS_CACHE, REDIS_STATE],
})
export class RedisModule {}