import type { DataSource } from 'typeorm'
import { OrdersRepository } from '../../src/repositories/orders.repository'
import { CheckoutError } from '../../src/services/checkout.service'
import { Product } from '../../src/entities/product.entity'
import { User } from '../../src/entities/user.entity'
import { Order } from '../../src/entities/order.entity'
import { startTestDatabase } from './testkit/database'
import type { TestDatabase } from './testkit/database'
import { anOrder, insertProduct, insertUser } from './testkit/builders'

describe('OrdersRepository', () => {
    let database: TestDatabase
    let dataSource: DataSource
    let orders: OrdersRepository

    beforeAll(async () => {
        database = await startTestDatabase()
        dataSource = database.dataSource
        orders = new OrdersRepository(dataSource)
    })

    beforeEach(async () => {
        await database.truncate()
    })

    afterAll(async () => {
        await database.stop()
    })

    it('should create an order with priced items, decrement stock and debit the balance', async () => {
        const buyer = await insertUser(dataSource, { balance: 1_000_000 })
        const kettle = await insertProduct(dataSource, { price: 100_000, stock: 5 })
        const laptop = await insertProduct(dataSource, { price: 300_000, stock: 5 })

        const order = await orders.create(anOrder(buyer.id, [
            { productId: laptop.id, quantity: 1 },
            { productId: kettle.id, quantity: 2 },
        ]))

        expect(order.status).toBe('paid')
        expect(order.total).toBe(500_000)
        expect(order.items.map((item) => [item.product.name, item.quantity, item.unitPrice])).toEqual([
            [kettle.name, 2, 100_000],
            [laptop.name, 1, 300_000],
        ])

        const [kettleAfter, laptopAfter, buyerAfter] = await Promise.all([
            dataSource.getRepository(Product).findOneByOrFail({ id: kettle.id }),
            dataSource.getRepository(Product).findOneByOrFail({ id: laptop.id }),
            dataSource.getRepository(User).findOneByOrFail({ id: buyer.id }),
        ])

        expect([kettleAfter.stock, laptopAfter.stock, buyerAfter.balance]).toEqual([3, 4, 500_000])
    })

    it('should roll back the whole order when one line is out of stock', async () => {
        const buyer = await insertUser(dataSource)
        const available = await insertProduct(dataSource, { stock: 5 })
        const soldOut = await insertProduct(dataSource, { stock: 0 })

        await expect(
            orders.create(anOrder(buyer.id, [
                { productId: available.id, quantity: 1 },
                { productId: soldOut.id, quantity: 1 },
            ])),
        ).rejects.toMatchObject({ reason: 'OUT_OF_STOCK', productId: soldOut.id })

        const availableAfter = await dataSource.getRepository(Product).findOneByOrFail({ id: available.id })

        expect(availableAfter.stock).toBe(5)
        expect(await dataSource.getRepository(Order).count()).toBe(0)
    })

    it('should report an unknown buyer without touching stock', async () => {
        const product = await insertProduct(dataSource, { stock: 2 })

        const failure = await orders.create(anOrder('999999', [{ productId: product.id, quantity: 1 }])).catch((error) => error)

        expect(failure).toBeInstanceOf(CheckoutError)
        expect(failure.reason).toBe('USER_NOT_FOUND')

        const productAfter = await dataSource.getRepository(Product).findOneByOrFail({ id: product.id })

        expect(productAfter.stock).toBe(2)
    })

    it('should return null for an unknown order id', async () => {
        expect(await orders.findById('999999')).toBeNull()
    })

    it('should list only the buyer own orders, newest first', async () => {
        const alice = await insertUser(dataSource)
        const bob = await insertUser(dataSource)
        const product = await insertProduct(dataSource, { stock: 10 })

        const first = await orders.create(anOrder(alice.id, [{ productId: product.id, quantity: 1 }]))
        await orders.create(anOrder(bob.id, [{ productId: product.id, quantity: 1 }]))
        const second = await orders.create(anOrder(alice.id, [{ productId: product.id, quantity: 2 }]))

        const listed = await orders.listByUser(alice.id)

        expect(listed.map((order) => order.id)).toEqual([second.id, first.id])
        expect(listed.every((order) => order.items.length === 1)).toBe(true)
    })

    it('should count orders grouped by status', async () => {
        const buyer = await insertUser(dataSource)
        const product = await insertProduct(dataSource, { stock: 10 })

        await orders.create(anOrder(buyer.id, [{ productId: product.id, quantity: 1 }]))
        await orders.create(anOrder(buyer.id, [{ productId: product.id, quantity: 1 }]))
        await dataSource.query(
            `INSERT INTO orders (user_id, status, total, created_at) VALUES ($1, 'cancelled', 0, now() - interval '1 day')`,
            [buyer.id],
        )

        expect(await orders.countByStatus()).toEqual([
            { status: 'cancelled', count: '1' },
            { status: 'paid', count: '2' },
        ])
    })
})
