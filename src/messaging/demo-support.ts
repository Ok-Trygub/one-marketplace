import type { Channel, ChannelModel } from 'amqplib'
import type { DataSource } from 'typeorm'
import { User } from '../entities/user.entity'
import { Product } from '../entities/product.entity'
import { OrdersRepository } from '../repositories/orders.repository'
import { PlaceOrderService } from '../services/place-order.service'
import { OrderPlacedPublisher } from './order-placed.publisher'
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

export const prepareFixture = async (dataSource: DataSource): Promise<DemoFixture> => {
    const buyers = dataSource.getRepository(User)
    const products = dataSource.getRepository(Product)

    await buyers.upsert(DEMO_BUYER, ['email'])
    await products.upsert(DEMO_PRODUCT, ['name'])

    const buyer = await buyers.findOneByOrFail({ email: DEMO_BUYER.email })
    const product = await products.findOneByOrFail({ name: DEMO_PRODUCT.name })

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

export const queueDepths = async (channel: Channel): Promise<{ work: number; dlq: number }> => {
    const work = await channel.checkQueue(ORDER_PLACED_QUEUE)
    const dlq = await channel.checkQueue(DEAD_LETTER_QUEUE)

    return { work: work.messageCount, dlq: dlq.messageCount }
}

export const createPlaceOrder = async (
    dataSource: DataSource,
    connection: ChannelModel,
): Promise<PlaceOrderService> => {
    const publisher = new OrderPlacedPublisher(connection)

    await publisher.open()

    return new PlaceOrderService(new OrdersRepository(dataSource), publisher)
}

export const countReceipts = async (dataSource: DataSource, buyerId: string): Promise<number> => {
    const [row] = await dataSource.query<{ count: string }[]>(
        `SELECT count(*) AS count FROM receipts WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`,
        [buyerId],
    )

    return Number(row.count)
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
