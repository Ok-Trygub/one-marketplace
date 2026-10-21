import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer, PREFETCH } from './messaging/order-placed.consumer'

const main = async () => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const consumer = await startConsumer({
        connection,
        dataSource: AppDataSource,
        ackDelayMs: Number(process.env.CONSUMER_ACK_DELAY_MS ?? 0),
        onEffect: (event) => console.log(`effect eventId=${event.eventId} orderId=${event.data.orderId}`),
    })

    console.log(`consumer started prefetch=${PREFETCH}`)

    const shutdown = async () => {
        await consumer.stop()
        await connection.close()
        await AppDataSource.destroy()
        console.log(
            `consumer stopped delivered=${consumer.stats.delivered} effect=${consumer.stats.effect} skipped=${consumer.stats.skipped} rejected=${consumer.stats.rejected}`,
        )
        process.exit(0)
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
