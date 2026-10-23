import { Queue, Worker } from 'bullmq'
import type { Job, Processor } from 'bullmq'
import type { Redis } from 'ioredis'
import type { ProductsRepository } from '../repositories/products.repository'
import { productCardKey } from '../services/product-card.service'
import type { ProductCardService } from '../services/product-card.service'

export const PRODUCT_CARDS_QUEUE = 'product-cards'
export const REFRESH_JOB = 'refresh'
export const REFRESH_ALL_JOB = 'refresh-all'
export const REFRESH_ALL_SCHEDULER = 'product-cards-refresh-all'

export type RefreshJobData = {
    productId?: string
}

export const createProductCardsQueue = (connection: Redis, name: string = PRODUCT_CARDS_QUEUE): Queue<RefreshJobData> =>
    new Queue<RefreshJobData>(name, {
        connection,
        defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 200, jitter: 0.5 },
            removeOnComplete: { age: 24 * 3600 },
            removeOnFail: { age: 7 * 24 * 3600 },
        },
    })

export const createProductCardsWorker = (
    connection: Redis,
    processor: Processor<RefreshJobData>,
    name: string = PRODUCT_CARDS_QUEUE,
): Worker<RefreshJobData> => new Worker<RefreshJobData>(name, processor, { connection })

export const enqueueRefresh = (
    queue: Queue<RefreshJobData>,
    productId: string,
    orderId: string,
): Promise<Job<RefreshJobData>> =>
    queue.add(REFRESH_JOB, { productId }, { jobId: `refresh-${productId}-order-${orderId}` })

export const upsertRefreshAllScheduler = (queue: Queue<RefreshJobData>, everyMs: number): Promise<Job<RefreshJobData>> =>
    queue.upsertJobScheduler(REFRESH_ALL_SCHEDULER, { every: everyMs }, { name: REFRESH_ALL_JOB, data: {} })

export const createRefreshProcessor = (
    cache: Redis,
    products: ProductsRepository,
    productCards: ProductCardService,
): Processor<RefreshJobData> => {
    const refresh = async (productId: string): Promise<void> => {
        await cache.del(productCardKey(productId))
        await productCards.get(productId)
    }

    return async (job) => {
        if (job.name === REFRESH_ALL_JOB) {
            for (const product of await products.findAll()) {
                await refresh(product.id)
            }

            return
        }

        if (job.data.productId) {
            await refresh(job.data.productId)
        }
    }
}