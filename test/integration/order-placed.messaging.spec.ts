import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Channel, ChannelModel } from 'amqplib'
import { connectBroker } from '../../src/messaging/broker'
import { OrderPlacedPublisher } from '../../src/messaging/order-placed.publisher'
import { toOrderPlacedEvent } from '../../src/messaging/order-placed.event'
import { RECEIPTS_CONSUMER, startConsumer } from '../../src/messaging/order-placed.consumer'
import type { RunningConsumer } from '../../src/messaging/order-placed.consumer'
import { relayBatch } from '../../src/messaging/outbox-relay'
import { checkout } from '../../src/services/checkout.service'
import { IdempotencyKeyReusedError, PlaceOrderService } from '../../src/services/place-order.service'
import { OrdersRepository } from '../../src/repositories/orders.repository'
import {
    DEAD_LETTER_QUEUE,
    EVENTS_EXCHANGE,
    ORDER_PLACED_QUEUE,
    ORDER_PLACED_ROUTING_KEY,
    assertTopology,
} from '../../src/messaging/topology'
import { Order } from '../../src/entities/order.entity'
import { Outbox } from '../../src/entities/outbox.entity'
import { ProcessedMessage } from '../../src/entities/processed-message.entity'
import { Product } from '../../src/entities/product.entity'
import { Receipt } from '../../src/entities/receipt.entity'
import { startTestDatabase } from './testkit/database'
import type { TestDatabase } from './testkit/database'
import { startTestBroker } from './testkit/broker'
import type { TestBroker } from './testkit/broker'
import { insertProduct, insertUser } from './testkit/builders'

const CRASH_MESSAGE = 'simulated crash'

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

    const placeOrder = async (idempotencyKey?: string) => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource)
        const service = new PlaceOrderService(new OrdersRepository(database.dataSource))
        const { order } = await service.place({
            userId: buyer.id,
            items: [{ productId: product.id, quantity: 1 }],
            idempotencyKey,
        })

        return order
    }

    const openPublisher = async (): Promise<OrderPlacedPublisher> => {
        const publisher = new OrderPlacedPublisher(connection)

        await publisher.open()

        return publisher
    }

    const crash = (): never => {
        throw new Error(CRASH_MESSAGE)
    }

    const outboxRows = () => database.dataSource.getRepository(Outbox).find({ order: { createdAt: 'ASC' } })
    const processedMessages = () => database.dataSource.getRepository(ProcessedMessage).find()
    const receipts = () => database.dataSource.getRepository(Receipt).find({ order: { id: 'ASC' } })
    const countOrders = () => database.dataSource.getRepository(Order).count()

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

    it('should write the outbox row together with the order and publish it through the relay once', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        const order = await placeOrder()
        const [row] = await outboxRows()

        expect(row).toMatchObject({
            aggregateType: 'Order',
            aggregateId: order.id,
            type: 'order.placed',
            publishedAt: null,
        })
        expect(row.payload).toMatchObject({
            eventId: `order.placed:${order.id}`,
            data: { orderId: order.id, userId: order.userId, total: order.total },
        })

        expect(await relayBatch(database.dataSource, await openPublisher())).toBe(1)

        await waitFor(() => consumer!.stats.acked === 1)

        expect(consumer.stats).toMatchObject({ delivered: 1, effect: 1, skipped: 0, alreadyApplied: 0 })
        expect(await receipts()).toEqual([
            expect.objectContaining({ eventId: `order.placed:${order.id}`, orderId: order.id, total: order.total }),
        ])
        expect(await processedMessages()).toEqual([
            expect.objectContaining({ messageId: row.id, consumer: RECEIPTS_CONSUMER }),
        ])
        expect((await outboxRows())[0].publishedAt).not.toBeNull()
    })

    it('should leave neither the order nor the outbox row when the write fails after the outbox insert', async () => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource, { stock: 5 })

        await expect(
            checkout(
                database.dataSource,
                { userId: buyer.id, items: [{ productId: product.id, quantity: 1 }] },
                { afterOutboxWrite: crash },
            ),
        ).rejects.toThrow(CRASH_MESSAGE)

        expect(await countOrders()).toBe(0)
        expect(await outboxRows()).toHaveLength(0)
        expect(await relayBatch(database.dataSource, await openPublisher())).toBe(0)
        expect((await channel.checkQueue(ORDER_PLACED_QUEUE)).messageCount).toBe(0)
        expect(
            (await database.dataSource.getRepository(Product).findOneByOrFail({ id: product.id })).stock,
        ).toBe(5)
    })

    it('should publish twice and apply the effect once when the relay dies between publish and update', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        await placeOrder()

        const publisher = await openPublisher()

        await expect(
            relayBatch(database.dataSource, publisher, { afterPublish: crash }),
        ).rejects.toThrow(CRASH_MESSAGE)

        expect((await outboxRows())[0].publishedAt).toBeNull()
        expect(await relayBatch(database.dataSource, publisher)).toBe(1)

        await waitFor(() => consumer!.stats.acked === 2)

        expect(consumer.stats).toMatchObject({ delivered: 2, effect: 1, skipped: 1, alreadyApplied: 0 })
        expect(await receipts()).toHaveLength(1)
        expect(await processedMessages()).toHaveLength(1)
    })

    it('should create one order and one outbox row for two concurrent requests with the same idempotency key', async () => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource)
        const service = new PlaceOrderService(new OrdersRepository(database.dataSource))
        const input = {
            userId: buyer.id,
            items: [{ productId: product.id, quantity: 1 }],
            idempotencyKey: 'same-intent',
        }

        const [first, second] = await Promise.all([service.place(input), service.place(input)])

        expect(second.order.id).toBe(first.order.id)
        expect([first.replay, second.replay].sort()).toEqual([false, true])
        expect(await countOrders()).toBe(1)
        expect(await outboxRows()).toHaveLength(1)
    })

    it('should refuse an idempotency key reused with a different body', async () => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource)
        const service = new PlaceOrderService(new OrdersRepository(database.dataSource))
        const input = {
            userId: buyer.id,
            items: [{ productId: product.id, quantity: 1 }],
            idempotencyKey: 'reused-key',
        }

        await service.place(input)

        await expect(
            service.place({ ...input, items: [{ productId: product.id, quantity: 2 }] }),
        ).rejects.toBeInstanceOf(IdempotencyKeyReusedError)
        expect(await countOrders()).toBe(1)
    })

    it('should issue one receipt when the same order arrives under a new message id', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        const order = await placeOrder()
        const publisher = await openPublisher()

        await publisher.publish(toOrderPlacedEvent(order), randomUUID())
        await publisher.publish(toOrderPlacedEvent(order), randomUUID())

        await waitFor(() => consumer!.stats.acked === 2)

        expect(consumer.stats).toMatchObject({ delivered: 2, effect: 1, skipped: 0, alreadyApplied: 1 })
        expect(await receipts()).toHaveLength(1)
        expect(await processedMessages()).toHaveLength(2)
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

    it('should dead-letter an event for a missing order after the delivery limit and keep no inbox mark', async () => {
        consumer = await startConsumer({ connection, dataSource: database.dataSource })

        const event = {
            eventId: 'order.placed:999999',
            type: 'order.placed',
            occurredAt: new Date().toISOString(),
            data: { orderId: '999999', userId: '1', total: 100, items: [] },
        }

        channel.publish(EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY, Buffer.from(JSON.stringify(event)), {
            messageId: randomUUID(),
        })

        await waitFor(() => consumer!.stats.requeued >= 4)
        await sleep(300)

        const dead = await channel.get(DEAD_LETTER_QUEUE, { noAck: true })

        expect((dead || undefined)?.properties.headers?.['x-first-death-reason']).toBe('delivery_limit')
        expect((await channel.checkQueue(ORDER_PLACED_QUEUE)).messageCount).toBe(0)
        expect(await receipts()).toHaveLength(0)
        expect(await processedMessages()).toHaveLength(0)
    })
})