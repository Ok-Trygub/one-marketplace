import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { OrderPlacedPublisher } from './messaging/order-placed.publisher'
import { relayBatch } from './messaging/outbox-relay'

const POLL_INTERVAL_MS = 1000

const main = async () => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const publisher = new OrderPlacedPublisher(connection)

    await publisher.open()

    let running = true

    const stop = () => {
        running = false
    }

    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    console.log(`relay started poll=${POLL_INTERVAL_MS}ms`)

    while (running) {
        const published = await relayBatch(AppDataSource, publisher)

        if (published > 0) {
            console.log(`relay published=${published}`)
        } else {
            await sleep(POLL_INTERVAL_MS)
        }
    }

    await connection.close()
    await AppDataSource.destroy()
    console.log('relay stopped')
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})