import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer } from './messaging/order-placed.consumer'
import { DEAD_LETTER_QUEUE, EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY } from './messaging/topology'
import {
    countReceipts,
    prepareFixture,
    printSummary,
    queueDepths,
    resetQueues,
    waitFor,
} from './messaging/demo-support'

const WAIT_MS = 10_000
const DEATH_REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit']

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer } = await prepareFixture(AppDataSource)

        await resetQueues(channel)

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })
        const publisher = await connection.createConfirmChannel()

        publisher.publish(EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY, Buffer.from('this is not an order.placed event'), {
            persistent: true,
            contentType: 'text/plain',
        })
        await publisher.waitForConfirms()
        await publisher.close()

        await waitFor(() => consumer.stats.rejected >= 1, WAIT_MS)
        await consumer.stop()

        const dead = await channel.get(DEAD_LETTER_QUEUE, { noAck: false })
        const reason = dead ? String(dead.properties.headers?.['x-first-death-reason']) : 'none'

        if (dead) {
            channel.nack(dead, false, true)
        }

        await sleep(300)

        const effect = await countReceipts(AppDataSource, buyer.id)
        const { work, dlq } = await queueDepths(channel)

        printSummary({
            rejected: consumer.stats.rejected,
            work,
            dlq,
            'dlq-reason': reason,
            effect,
        })

        const ok = work === 0 && dlq === 1 && DEATH_REASONS.includes(reason) && effect === 0

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
