import type { Channel, ChannelModel } from 'amqplib'
import type { DataSource } from 'typeorm'
import { User } from '../entities/user.entity'
import { Product } from '../entities/product.entity'
import { OrdersRepository } from '../repositories/orders.repository'
import { PlaceOrderService } from '../services/place-order.service'
import { OrderPlacedPublisher } from './order-placed.publisher'
import { RECEIPTS_CONSUMER } from './order-placed.consumer'
import { relayBatch } from './outbox-relay'
import { DEAD_LETTER_QUEUE, ORDER_PLACED_QUEUE, assertTopology } from './topology'

export const DEMO_BUYER = {
    email: 'demo-rabbitmq@example.com',
    phone: '+380990000777',
    name: 'Demo RabbitMQ Buyer',
    balance: 1_000_000_000,
}

export const DEMO_PRODUCT = {
    name: 'Demo product for RabbitMQ',
    description: 'Created by the RabbitMQ demos, reset on every run',
    price: 100,
    stock: 1_000,
}

export type DemoFixture = {
    buyer: User
    product: Product
}

const countRows = async (dataSource: DataSource, sql: string, params: unknown[]): Promise<number> => {
    const [row] = await dataSource.query<{ count: string }[]>(sql, params)

    return Number(row.count)
}

export const prepareFixture = async (dataSource: DataSource): Promise<DemoFixture> => {
    const buyers = dataSource.getRepository(User)
    const products = dataSource.getRepository(Product)

    await buyers.upsert(DEMO_BUYER, ['email'])
    await products.upsert(DEMO_PRODUCT, ['name'])

    const buyer = await buyers.findOneByOrFail({ email: DEMO_BUYER.email })
    const product = await products.findOneByOrFail({ name: DEMO_PRODUCT.name })

    await dataSource.query(
        `DELETE FROM processed_messages WHERE message_id IN (SELECT id FROM outbox WHERE payload->'data'->>'userId' = $1)`,
        [buyer.id],
    )
    await dataSource.query(`DELETE FROM outbox WHERE payload->'data'->>'userId' = $1`, [buyer.id])
    await dataSource.query(
        `DELETE FROM receipts WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`,
        [buyer.id],
    )
    await dataSource.query(
        `DELETE FROM jobs WHERE type = 'send_receipt' AND (payload->>'orderId')::bigint IN (SELECT id FROM orders WHERE user_id = $1)`,
        [buyer.id],
    )
    await dataSource.query(
        `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`,
        [buyer.id],
    )
    await dataSource.query(`DELETE FROM orders WHERE user_id = $1`, [buyer.id])

    return { buyer, product }
}

export const resetQueues = async (channel: Channel): Promise<void> => {
    await assertTopology(channel)
    await channel.purgeQueue(ORDER_PLACED_QUEUE)
    await channel.purgeQueue(DEAD_LETTER_QUEUE)
}

export const resetMessaging = async (
    dataSource: DataSource,
    connection: ChannelModel,
    channel: Channel,
): Promise<void> => {
    await assertTopology(channel)

    const publisher = await createPublisher(connection)
    let published = await relayBatch(dataSource, publisher)

    while (published > 0) {
        published = await relayBatch(dataSource, publisher)
    }

    await resetQueues(channel)
}

export const queueDepths = async (channel: Channel): Promise<{ work: number; dlq: number }> => {
    const work = await channel.checkQueue(ORDER_PLACED_QUEUE)
    const dlq = await channel.checkQueue(DEAD_LETTER_QUEUE)

    return { work: work.messageCount, dlq: dlq.messageCount }
}

export const createPlaceOrder = (dataSource: DataSource): PlaceOrderService => {
    return new PlaceOrderService(new OrdersRepository(dataSource))
}

export const createPublisher = async (connection: ChannelModel): Promise<OrderPlacedPublisher> => {
    const publisher = new OrderPlacedPublisher(connection)

    await publisher.open()

    return publisher
}

export const countOrders = (dataSource: DataSource, buyerId: string): Promise<number> => {
    return countRows(dataSource, `SELECT count(*) AS count FROM orders WHERE user_id = $1`, [buyerId])
}

export const countOutbox = (dataSource: DataSource, buyerId: string, publishedOnly = false): Promise<number> => {
    return countRows(
        dataSource,
        `SELECT count(*) AS count FROM outbox
         WHERE payload->'data'->>'userId' = $1
           AND ($2::boolean = false OR published_at IS NOT NULL)`,
        [buyerId, publishedOnly],
    )
}

export const countProcessed = (dataSource: DataSource, buyerId: string): Promise<number> => {
    return countRows(
        dataSource,
        `SELECT count(*) AS count FROM processed_messages
         WHERE consumer = $2
           AND message_id IN (SELECT id FROM outbox WHERE payload->'data'->>'userId' = $1)`,
        [buyerId, RECEIPTS_CONSUMER],
    )
}

export const countReceipts = (dataSource: DataSource, buyerId: string): Promise<number> => {
    return countRows(
        dataSource,
        `SELECT count(*) AS count FROM receipts WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`,
        [buyerId],
    )
}

export const waitFor = async (condition: () => boolean, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        if (condition()) {
            return true
        }

        await new Promise((resolve) => setTimeout(resolve, 50))
    }

    return condition()
}

export const printSummary = (summary: Record<string, number | string>): void => {
    for (const [key, value] of Object.entries(summary)) {
        console.log(`${key}=${value}`)
    }
}