import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer } from './messaging/order-placed.consumer'
import { relayBatch } from './messaging/outbox-relay'
import { checkout } from './services/checkout.service'
import {
    countOrders,
    countOutbox,
    countReceipts,
    createPublisher,
    prepareFixture,
    printSummary,
    resetMessaging,
} from './messaging/demo-support'

const CRASH_MESSAGE = 'simulated crash after the outbox write'
const SETTLE_MS = 1_000

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer, product } = await prepareFixture(AppDataSource)

        await resetMessaging(AppDataSource, connection, channel)

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })

        let writeFailed = 0

        try {
            await checkout(
                AppDataSource,
                { userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] },
                {
                    afterOutboxWrite: () => {
                        throw new Error(CRASH_MESSAGE)
                    },
                },
            )
        } catch (error) {
            if (!(error instanceof Error) || error.message !== CRASH_MESSAGE) {
                throw error
            }

            writeFailed += 1
        }

        const publisher = await createPublisher(connection)

        await relayBatch(AppDataSource, publisher)
        await sleep(SETTLE_MS)
        await consumer.stop()

        const summary = {
            'write-failed': writeFailed,
            orders: await countOrders(AppDataSource, buyer.id),
            outbox: await countOutbox(AppDataSource, buyer.id),
            published: await countOutbox(AppDataSource, buyer.id, true),
            deliveries: consumer.stats.delivered,
            effect: await countReceipts(AppDataSource, buyer.id),
        }

        printSummary(summary)

        const ok =
            summary['write-failed'] === 1 &&
            summary.orders === 0 &&
            summary.outbox === 0 &&
            summary.published === 0 &&
            summary.deliveries === 0 &&
            summary.effect === 0

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