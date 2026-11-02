import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { OrderPlacedPublisher } from './messaging/order-placed.publisher'
import { relayBatch } from './messaging/outbox-relay'
import { cleanupOutbox } from './messaging/outbox-cleanup'

const POLL_INTERVAL_MS = 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const main = async () => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const publisher = new OrderPlacedPublisher(connection)

    await publisher.open()

    let running = true
    let nextCleanupAt = 0

    const stop = () => {
        running = false
    }

    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    console.log(`relay started poll=${POLL_INTERVAL_MS}ms cleanup=${CLEANUP_INTERVAL_MS}ms`)

    while (running) {
        if (Date.now() >= nextCleanupAt) {
            const deleted = await cleanupOutbox(AppDataSource)

            if (deleted > 0) {
                console.log(`relay cleaned outbox=${deleted}`)
            }

            nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS
        }

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
