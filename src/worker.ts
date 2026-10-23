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

const REFRESH_ALL_EVERY_MS = 5 * 60 * 1000

const main = async () => {
    await AppDataSource.initialize()

    const cache = connectCache()
    const connection = connectQueue()
    const products = new ProductsRepository(AppDataSource)
    const productCards = new ProductCardService(products, cache)
    const queue = createProductCardsQueue(connection)

    await upsertRefreshAllScheduler(queue, REFRESH_ALL_EVERY_MS)

    const worker = createProductCardsWorker(connection, createRefreshProcessor(cache, products, productCards))

    worker.on('failed', (job, error) => {
        console.error(`job ${job?.id} attempt ${job?.attemptsMade} failed: ${error.message}`)
    })

    const stop = async () => {
        await worker.close()
        await queue.close()
        await connection.quit()
        await cache.quit()
        await AppDataSource.destroy()
        console.log('worker stopped')
    }

    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())

    console.log(`worker started refresh-all=${REFRESH_ALL_EVERY_MS}ms`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})