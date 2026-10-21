import { setTimeout as sleep } from 'node:timers/promises'
import type { Channel, ChannelModel } from 'amqplib'
import { connectBroker } from '../../src/messaging/broker'
import { OrderPlacedPublisher } from '../../src/messaging/order-placed.publisher'
import { orderPlacedEvent } from '../../src/messaging/order-placed.event'
import { startConsumer } from '../../src/messaging/order-placed.consumer'
import type { RunningConsumer } from '../../src/messaging/order-placed.consumer'
import { PlaceOrderService } from '../../src/services/place-order.service'
import { OrdersRepository } from '../../src/repositories/orders.repository'
import {
    DEAD_LETTER_QUEUE,
    EVENTS_EXCHANGE,
    ORDER_PLACED_QUEUE,
    ORDER_PLACED_ROUTING_KEY,
    assertTopology,
} from '../../src/messaging/topology'
import { Receipt } from '../../src/entities/receipt.entity'
import { startTestDatabase } from './testkit/database'
import type { TestDatabase } from './testkit/database'
import { startTestBroker } from './testkit/broker'
import type { TestBroker } from './testkit/broker'
import { insertProduct, insertUser } from './testkit/builders'

describe('order.placed messaging', () => {
    let database: TestDatabase
    let broker: TestBroker
    let connection: ChannelModel
    let channel: Channel
    let consumer: RunningConsumer | null = null

    const waitFor = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
        const deadline = Date.now() + timeoutMs

        while (!condition() && Date.now() < deadline) {
            await sleep(50)
        }
    }

    const placeOrder = async () => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource)
        const publisher = new OrderPlacedPublisher(connection)

        await publisher.open()

        const service = new PlaceOrderService(new OrdersRepository(database.dataSource), publisher)

        return service.place({ userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] })
    }

    const receipts = () => database.dataSource.getRepository(Receipt).find({ order: { id: 'ASC' } })

    beforeAll(async () => {
        database = await startTestDatabase()
        broker = await startTestBroker()
        connection = await connectBroker(broker.url)
        channel = await connection.createChannel()

        await assertTopology(channel)
    })

    beforeEach(async () => {
        await database.truncate()
        await channel.purgeQueue(ORDER_PLACED_QUEUE)
        await channel.purgeQueue(DEAD_LETTER_QUEUE)
    })

    afterEach(async () => {
        await consumer?.stop()
        consumer = null
    })

    afterAll(async () => {
        await connection?.close()
        await database?.stop()
        await broker?.stop()
    })

    it('should publish order.placed from the business operation and issue one receipt', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        const order = await placeOrder()

        await waitFor(() => consumer!.stats.acked === 1)

        expect(consumer.stats).toMatchObject({ delivered: 1, effect: 1, skipped: 0, rejected: 0 })
        expect(await receipts()).toEqual([
            expect.objectContaining({ eventId: `order.placed:${order.id}`, orderId: order.id, total: order.total }),
        ])
    })

    it('should apply the effect once when the same event is delivered twice', async () => {
        const order = await placeOrder()
        const publisher = new OrderPlacedPublisher(connection)

        await publisher.open()
        await publisher.publish(orderPlacedEvent(order))

        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        await waitFor(() => consumer!.stats.acked === 2)

        expect(consumer.stats).toMatchObject({ delivered: 2, effect: 1, skipped: 1, acked: 2 })
        expect(await receipts()).toHaveLength(1)
    })

    it('should dead-letter a poison message with a readable reason', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        channel.publish(EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY, Buffer.from('not json'))

        await waitFor(() => consumer!.stats.rejected === 1)

        const dead = await channel.get(DEAD_LETTER_QUEUE, { noAck: true })

        expect(dead).not.toBe(false)
        expect((dead || undefined)?.properties.headers?.['x-first-death-reason']).toBe('rejected')
        expect((dead || undefined)?.properties.headers?.['x-first-death-queue']).toBe(ORDER_PLACED_QUEUE)
        expect(await receipts()).toHaveLength(0)
    })

    it('should dead-letter an event for a missing order after the delivery limit', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        const event = {
            eventId: 'order.placed:999999',
            type: 'order.placed',
            occurredAt: new Date().toISOString(),
            data: { orderId: '999999', userId: '1', total: 100, items: [] },
        }

        channel.publish(EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY, Buffer.from(JSON.stringify(event)))

        await waitFor(() => consumer!.stats.requeued >= 4)
        await sleep(300)

        const dead = await channel.get(DEAD_LETTER_QUEUE, { noAck: true })

        expect((dead || undefined)?.properties.headers?.['x-first-death-reason']).toBe('delivery_limit')
        expect((await channel.checkQueue(ORDER_PLACED_QUEUE)).messageCount).toBe(0)
        expect(await receipts()).toHaveLength(0)
    })
})
