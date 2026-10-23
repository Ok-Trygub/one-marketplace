import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { AppDataSource } from './data-source'
import { printSummary, waitFor } from './messaging/demo-support'
import { connectCache, connectQueue } from './redis/redis'
import { ProductsRepository } from './repositories/products.repository'
import { ProductCardService } from './services/product-card.service'
import {
    REFRESH_ALL_JOB,
    REFRESH_ALL_SCHEDULER,
    REFRESH_JOB,
    createProductCardsQueue,
    createProductCardsWorker,
    createRefreshProcessor,
    enqueueRefresh,
    upsertRefreshAllScheduler,
} from './queue/product-cards.queue'
import type { RefreshJobData } from './queue/product-cards.queue'

const DEMO_QUEUE = 'demo-product-cards'
const DEMO_ORDER_ID = 'demo'
const FAIL_TIMES = 2
const SCHEDULE_EVERY_MS = 500
const MIN_SCHEDULED_RUNS = 2
const WAIT_MS = 15_000

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const cache = connectCache()
    const connection = connectQueue()
    const queue = createProductCardsQueue(connection, DEMO_QUEUE)
    let worker: Worker<RefreshJobData> | null = null

    try {
        const [, policy] = (await connection.config('GET', 'maxmemory-policy')) as string[]

        await queue.obliterate({ force: true })

        const products = new ProductsRepository(AppDataSource)
        const productCards = new ProductCardService(products, cache)
        const refresh = createRefreshProcessor(cache, products, productCards)
        const [product] = await products.findAll()
        const productId = product?.id ?? '1'

        const jobs = [
            await enqueueRefresh(queue, productId, DEMO_ORDER_ID),
            await enqueueRefresh(queue, productId, DEMO_ORDER_ID),
        ]
        const queued = await queue.count()

        await upsertRefreshAllScheduler(queue, SCHEDULE_EVERY_MS)
        await upsertRefreshAllScheduler(queue, SCHEDULE_EVERY_MS)

        const schedulers = await queue.getJobSchedulersCount()

        let attempts = 0
        let completed = 0
        let scheduledRuns = 0

        worker = createProductCardsWorker(
            connection,
            async (job) => {
                if (job.name === REFRESH_JOB) {
                    attempts += 1

                    if (attempts <= FAIL_TIMES) {
                        throw new Error(`simulated failure ${attempts}`)
                    }
                }

                await refresh(job)
            },
            DEMO_QUEUE,
        )

        worker.on('completed', (job) => {
            if (job.name === REFRESH_JOB) {
                completed += 1
            }

            if (job.name === REFRESH_ALL_JOB) {
                scheduledRuns += 1
            }
        })

        await waitFor(() => completed >= 1 && scheduledRuns >= MIN_SCHEDULED_RUNS, WAIT_MS)

        const summary = {
            'queue-noeviction': policy === 'noeviction' ? 1 : 0,
            attempts,
            completed,
            added: jobs.length,
            queued,
            schedulers,
            'scheduled-runs': scheduledRuns,
        }

        printSummary(summary)

        const ok =
            summary['queue-noeviction'] === 1 &&
            summary.attempts >= 3 &&
            summary.completed === 1 &&
            summary.added === 2 &&
            summary.queued === 1 &&
            summary.schedulers >= 1 &&
            summary['scheduled-runs'] >= MIN_SCHEDULED_RUNS

        return ok ? 0 : 1
    } finally {
        if (worker) {
            await worker.close()
        }

        await queue.removeJobScheduler(REFRESH_ALL_SCHEDULER)
        await queue.obliterate({ force: true })
        await queue.close()
        await connection.quit()
        await cache.quit()
        await AppDataSource.destroy()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })