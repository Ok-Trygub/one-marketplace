import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer } from './messaging/order-placed.consumer'
import { relayBatch } from './messaging/outbox-relay'
import {
    countOutbox,
    countProcessed,
    countReceipts,
    createPlaceOrder,
    createPublisher,
    prepareFixture,
    printSummary,
    resetMessaging,
    waitFor,
} from './messaging/demo-support'

const CRASH_MESSAGE = 'simulated relay crash between publish and UPDATE published_at'
const IDEMPOTENCY_KEY = 'demo-crash-relay'
const WAIT_MS = 10_000

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer, product } = await prepareFixture(AppDataSource)

        await resetMessaging(AppDataSource, connection, channel)

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })

        await createPlaceOrder(AppDataSource).place({
            userId: buyer.id,
            items: [{ productId: product.id, quantity: 1 }],
            idempotencyKey: IDEMPOTENCY_KEY,
        })

        const publisher = await createPublisher(connection)

        let crashes = 0

        try {
            await relayBatch(AppDataSource, publisher, {
                afterPublish: () => {
                    throw new Error(CRASH_MESSAGE)
                },
            })
        } catch (error) {
            if (!(error instanceof Error) || error.message !== CRASH_MESSAGE) {
                throw error
            }

            crashes += 1
        }

        const publishedAfterCrash = await countOutbox(AppDataSource, buyer.id, true)

        await relayBatch(AppDataSource, publisher)
        await waitFor(() => consumer.stats.acked >= 2, WAIT_MS)
        await consumer.stop()

        const summary = {
            crashes,
            'published-after-crash': publishedAfterCrash,
            published: await countOutbox(AppDataSource, buyer.id, true),
            deliveries: consumer.stats.delivered,
            applied: consumer.stats.effect,
            duplicates: consumer.stats.skipped,
            effect: await countReceipts(AppDataSource, buyer.id),
            processed: await countProcessed(AppDataSource, buyer.id),
        }

        printSummary(summary)

        const ok =
            summary.crashes === 1 &&
            summary['published-after-crash'] === 0 &&
            summary.published === 1 &&
            summary.deliveries >= 2 &&
            summary.applied === 1 &&
            summary.effect === 1 &&
            summary.processed === 1

        return ok ? 0 : 1
    } finally {
        await connection.close()
        await AppDataSource.destroy()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })