import 'reflect-metadata'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { AppDataSource } from './data-source'
import { connectBroker } from './messaging/broker'
import { startConsumer } from './messaging/order-placed.consumer'
import {
    countReceipts,
    createPlaceOrder,
    prepareFixture,
    printSummary,
    resetQueues,
    waitFor,
} from './messaging/demo-support'

const WAIT_MS = 10_000
const ACK_DELAY_MS = 5_000

type CrashingConsumer = {
    deliveries: number
    waitForEffect: () => Promise<void>
    crash: () => Promise<void>
}

const startCrashingConsumer = async (): Promise<CrashingConsumer> => {
    const child = spawn(process.execPath, [path.join(__dirname, 'consumer.js')], {
        env: { ...process.env, CONSUMER_ACK_DELAY_MS: String(ACK_DELAY_MS) },
        stdio: ['ignore', 'pipe', 'inherit'],
    })
    const state: CrashingConsumer = { deliveries: 0, waitForEffect: () => Promise.resolve(), crash: () => Promise.resolve() }

    let started: () => void = () => {}
    let effectSeen: () => void = () => {}
    const startedPromise = new Promise<void>((resolve) => {
        started = resolve
    })
    const effectPromise = new Promise<void>((resolve) => {
        effectSeen = resolve
    })

    createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.startsWith('consumer started')) {
            started()
        }

        if (line.startsWith('effect ')) {
            state.deliveries += 1
            effectSeen()
        }
    })

    state.waitForEffect = () => effectPromise
    state.crash = () =>
        new Promise((resolve) => {
            child.once('exit', () => resolve())
            child.kill('SIGKILL')
        })

    await startedPromise

    return state
}

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const connection = await connectBroker()
    const channel = await connection.createChannel()

    try {
        const { buyer, product } = await prepareFixture(AppDataSource)

        await resetQueues(channel)

        const crashing = await startCrashingConsumer()
        const placeOrder = await createPlaceOrder(AppDataSource, connection)

        await placeOrder.place({ userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] })
        await crashing.waitForEffect()
        await crashing.crash()

        const consumer = await startConsumer({ connection, dataSource: AppDataSource })

        await waitFor(() => consumer.stats.acked >= 1, WAIT_MS)
        await consumer.stop()

        const effect = await countReceipts(AppDataSource, buyer.id)
        const deliveries = crashing.deliveries + consumer.stats.delivered

        printSummary({
            deliveries,
            effect,
            skipped: consumer.stats.skipped,
        })

        const ok = deliveries >= 2 && effect === 1 && consumer.stats.skipped === deliveries - 1

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
