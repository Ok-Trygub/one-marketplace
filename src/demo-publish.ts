import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { PREFETCH, startConsumer } from './messaging/order-placed.consumer'
import {
    countReceipts,
    createPlaceOrder,
    prepareFixture,
    printSummary,
    queueDepths,
    resetQueues,
    waitFor,
} from './messaging/demo-support'

const ORDERS = 5
const WAIT_MS = 10_000

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer, product } = await prepareFixture(AppDataSource)

        await resetQueues(channel)

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })
        const placeOrder = await createPlaceOrder(AppDataSource, connection)

        let published = 0

        for (let index = 0; index < ORDERS; index += 1) {
            await placeOrder.place({ userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] })
            published += 1
        }

        await waitFor(() => consumer.stats.acked >= ORDERS, WAIT_MS)
        await consumer.stop()

        const effect = await countReceipts(AppDataSource, buyer.id)
        const { work, dlq } = await queueDepths(channel)

        printSummary({
            published,
            delivered: consumer.stats.delivered,
            effect,
            acked: consumer.stats.acked,
            work,
            dlq,
            prefetch: PREFETCH,
        })

        const ok = published === ORDERS && effect === ORDERS && consumer.stats.acked === ORDERS && dlq === 0 && work === 0

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
