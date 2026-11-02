import { Module } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { connectQueueProducer } from '../redis/redis'
import { PRODUCT_CARDS_QUEUE_TOKEN, createProductCardsQueue } from './product-cards.queue'
import type { RefreshJobData } from './product-cards.queue'
import type { Env } from '../config/env.schema'

const PRODUCT_CARDS_QUEUE_CONNECTION = 'PRODUCT_CARDS_QUEUE_CONNECTION'

class ProductCardsQueueLifecycle implements OnModuleDestroy {
    constructor(
        private readonly queue: Queue<RefreshJobData>,
        private readonly connection: Redis,
    ) {}

    async onModuleDestroy(): Promise<void> {
        await this.queue.close()
        this.connection.disconnect()
    }
}

@Module({
    providers: [
        {
            provide: PRODUCT_CARDS_QUEUE_CONNECTION,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) =>
                connectQueueProducer(process.env.REDIS_QUEUE_URL ?? config.get('REDIS_QUEUE_URL', { infer: true })),
        },
        {
            provide: PRODUCT_CARDS_QUEUE_TOKEN,
            inject: [PRODUCT_CARDS_QUEUE_CONNECTION],
            useFactory: (connection: Redis) => {
                const queue = createProductCardsQueue(connection)

                queue.on('error', (error) => {
                    console.warn(`product-cards queue: ${error.message}`)
                })

                return queue
            },
        },
        {
            provide: ProductCardsQueueLifecycle,
            inject: [PRODUCT_CARDS_QUEUE_TOKEN, PRODUCT_CARDS_QUEUE_CONNECTION],
            useFactory: (queue: Queue<RefreshJobData>, connection: Redis) =>
                new ProductCardsQueueLifecycle(queue, connection),
        },
    ],
    exports: [PRODUCT_CARDS_QUEUE_TOKEN],
})
export class ProductCardsQueueModule {}
