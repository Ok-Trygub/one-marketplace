import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { connectCache, connectQueue } from './redis/redis'
import { ProductsRepository } from './repositories/products.repository'
import { ProductCardService } from './services/product-card.service'
import {
    createProductCardsQueue,
    createProductCardsWorker,
    createRefreshProcessor,
    upsertRefreshAllScheduler,
} from './queue/product-cards.queue'
import {
    createOrphanCleanupProcessor,
    createOrphanFilesQueue,
    createOrphanFilesWorker,
    upsertOrphanCleanupScheduler,
} from './queue/orphan-files.queue'
import { createStorageClient, storageBucketFromEnv, storageConnectionFromEnv } from './storage/storage-client'
import { StorageService } from './storage/storage.service'

const REFRESH_ALL_EVERY_MS = 5 * 60 * 1000
const ORPHAN_CLEANUP_EVERY_MS = 60 * 60 * 1000

const main = async () => {
    await AppDataSource.initialize()

    const cache = connectCache()
    const connection = connectQueue()
    const products = new ProductsRepository(AppDataSource)
    const productCards = new ProductCardService(products, cache)
    const storage = new StorageService(createStorageClient(storageConnectionFromEnv()), storageBucketFromEnv())
    const queue = createProductCardsQueue(connection)
    const orphanQueue = createOrphanFilesQueue(connection)

    await upsertRefreshAllScheduler(queue, REFRESH_ALL_EVERY_MS)
    await upsertOrphanCleanupScheduler(orphanQueue, ORPHAN_CLEANUP_EVERY_MS)

    const worker = createProductCardsWorker(connection, createRefreshProcessor(cache, products, productCards))
    const orphanWorker = createOrphanFilesWorker(connection, createOrphanCleanupProcessor(AppDataSource, storage))

    for (const running of [worker, orphanWorker]) {
        running.on('failed', (job, error) => {
            console.error(`job ${job?.id} attempt ${job?.attemptsMade} failed: ${error.message}`)
        })
    }

    const stop = async () => {
        await worker.close()
        await orphanWorker.close()
        await queue.close()
        await orphanQueue.close()
        await connection.quit()
        await cache.quit()
        await AppDataSource.destroy()
        console.log('worker stopped')
    }

    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())

    console.log(`worker started refresh-all=${REFRESH_ALL_EVERY_MS}ms orphan-cleanup=${ORPHAN_CLEANUP_EVERY_MS}ms`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})