import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/http/configure-app'
import { startTestDatabase } from '../integration/testkit/database'
import type { TestDatabase } from '../integration/testkit/database'
import { insertProduct, insertUser } from '../integration/testkit/builders'

describe('orders (e2e)', () => {
    let database: TestDatabase
    let app: INestApplication

    beforeAll(async () => {
        database = await startTestDatabase()
        process.env.DATABASE_URL = database.container.getConnectionUri()

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

        app = configureApp(moduleRef.createNestApplication())

        await app.init()
    })

    beforeEach(async () => {
        await database.truncate()
    })

    afterAll(async () => {
        await app?.close()
        await database?.stop()
    })

    it('should create an order and read it back', async () => {
        const buyer = await insertUser(database.dataSource)
        const kettle = await insertProduct(database.dataSource, { price: 149_900, stock: 10 })
        const laptop = await insertProduct(database.dataSource, { price: 3_999_900, stock: 10 })

        const created = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', 'e2e-create-order')
            .send({
                user_id: buyer.id,
                items: [
                    { product_id: kettle.id, quantity: 2 },
                    { product_id: laptop.id, quantity: 1 },
                ],
            })
            .expect(201)

        expect(created.body).toMatchObject({
            status: 'paid',
            total_cents: 2 * 149_900 + 3_999_900,
            items: [
                { product_id: kettle.id, quantity: 2, price_cents: 149_900 },
                { product_id: laptop.id, quantity: 1, price_cents: 3_999_900 },
            ],
        })

        const read = await request(app.getHttpServer())
            .get(`/orders/${created.body.id}`)
            .expect(200)

        expect(read.body).toEqual(created.body)

        const replay = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', 'e2e-create-order')
            .send({
                user_id: buyer.id,
                items: [
                    { product_id: kettle.id, quantity: 2 },
                    { product_id: laptop.id, quantity: 1 },
                ],
            })
            .expect(201)

        expect(replay.headers['idempotency-replay']).toBe('true')
        expect(replay.body.id).toBe(created.body.id)
    })

    it('should return 404 in problem+json for an unknown order', async () => {
        const response = await request(app.getHttpServer())
            .get('/orders/999999')
            .expect(404)

        expect(response.headers['content-type']).toContain('application/problem+json')
        expect(response.body).toMatchObject({ status: 404, instance: '/orders/999999' })
    })

    it('should return 400 when the body violates the OpenAPI contract', async () => {
        const response = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', 'e2e-invalid-body')
            .send({ items: [] })
            .expect(400)

        expect(response.headers['content-type']).toContain('application/problem+json')
        expect(response.body.detail).toContain('user_id')
    })

    it('should return 409 when the product is out of stock', async () => {
        const buyer = await insertUser(database.dataSource)
        const soldOut = await insertProduct(database.dataSource, { stock: 0 })

        await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', 'e2e-out-of-stock')
            .send({ user_id: buyer.id, items: [{ product_id: soldOut.id, quantity: 1 }] })
            .expect(409)
    })
})
