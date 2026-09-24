import type { DataSource } from 'typeorm'
import { ProductsRepository } from '../../src/repositories/products.repository'
import { OrdersRepository } from '../../src/repositories/orders.repository'
import { startTestDatabase } from './testkit/database'
import type { TestDatabase } from './testkit/database'
import { aProduct, anOrder, insertProduct, insertUser } from './testkit/builders'

const errorCode = (error: unknown): string | undefined =>
    (error as { driverError?: { code?: string } }).driverError?.code

describe('ProductsRepository', () => {
    let database: TestDatabase
    let dataSource: DataSource
    let products: ProductsRepository

    beforeAll(async () => {
        database = await startTestDatabase()
        dataSource = database.dataSource
        products = new ProductsRepository(dataSource)
    })

    beforeEach(async () => {
        await database.truncate()
    })

    afterAll(async () => {
        await database.stop()
    })

    it('should create a product and read it back by id', async () => {
        const created = await products.create(aProduct({ price: 250_000, stock: 3 }))

        const found = await products.findById(created.id)

        expect(found).not.toBeNull()
        expect(found).toMatchObject({ id: created.id, name: created.name, price: 250_000, stock: 3 })
        expect(found?.createdAt).toBeInstanceOf(Date)
    })

    it('should reject a duplicate product name with a unique violation', async () => {
        const first = await products.create(aProduct())

        await expect(products.create(aProduct({ name: first.name }))).rejects.toMatchObject({
            driverError: { code: '23505' },
        })
    })

    it('should list products ordered by id', async () => {
        const b = await insertProduct(dataSource, { name: 'B product' })
        const a = await insertProduct(dataSource, { name: 'A product' })

        const all = await products.findAll()

        expect(all.map((product) => product.id)).toEqual([b.id, a.id])
    })

    it('should aggregate revenue per product across paid orders', async () => {
        const kettle = await insertProduct(dataSource, { price: 100_000, stock: 10 })
        const laptop = await insertProduct(dataSource, { price: 500_000, stock: 10 })
        const buyer = await insertUser(dataSource)
        const orders = new OrdersRepository(dataSource)

        await orders.create(anOrder(buyer.id, [
            { productId: kettle.id, quantity: 2 },
            { productId: laptop.id, quantity: 1 },
        ]))
        await orders.create(anOrder(buyer.id, [{ productId: kettle.id, quantity: 1 }]))

        const revenue = await products.revenueByProduct()

        expect(revenue).toEqual([
            { productId: laptop.id, productName: laptop.name, unitsSold: '1', revenue: '500000' },
            { productId: kettle.id, productName: kettle.name, unitsSold: '3', revenue: '300000' },
        ])
    })

    it('should refuse to delete a product that has order items', async () => {
        const product = await insertProduct(dataSource)
        const buyer = await insertUser(dataSource)

        await new OrdersRepository(dataSource).create(anOrder(buyer.id, [{ productId: product.id, quantity: 1 }]))

        let caught: unknown

        try {
            await dataSource.query('DELETE FROM products WHERE id = $1', [product.id])
        } catch (error) {
            caught = error
        }

        expect(errorCode(caught)).toBe('23503')
        expect(await products.findById(product.id)).not.toBeNull()
    })
})
