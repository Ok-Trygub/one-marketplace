import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer } from './messaging/order-placed.consumer'
import { relayBatch } from './messaging/outbox-relay'
import {
    countOrders,
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

const IDEMPOTENCY_KEY = 'demo-outbox'
const WAIT_MS = 10_000

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer, product } = await prepareFixture(AppDataSource)

        await resetMessaging(AppDataSource, connection, channel)

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })
        const placeOrder = createPlaceOrder(AppDataSource)
        const input = {
            userId: buyer.id,
            items: [{ productId: product.id, quantity: 1 }],
            idempotencyKey: IDEMPOTENCY_KEY,
        }

        const results = await Promise.all([placeOrder.place(input), placeOrder.place(input)])

        const publisher = await createPublisher(connection)

        await relayBatch(AppDataSource, publisher)
        await waitFor(() => consumer.stats.acked >= 1, WAIT_MS)
        await consumer.stop()

        const summary = {
            requests: results.length,
            replays: results.filter((result) => result.replay).length,
            orders: await countOrders(AppDataSource, buyer.id),
            outbox: await countOutbox(AppDataSource, buyer.id),
            published: await countOutbox(AppDataSource, buyer.id, true),
            deliveries: consumer.stats.delivered,
            effect: await countReceipts(AppDataSource, buyer.id),
            processed: await countProcessed(AppDataSource, buyer.id),
        }

        printSummary(summary)

        const ok =
            summary.requests === 2 &&
            summary.orders === 1 &&
            summary.outbox === 1 &&
            summary.published === 1 &&
            summary.deliveries === 1 &&
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