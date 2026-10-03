import { MatchersV3, PactV3 } from '@pact-foundation/pact'
import { CONSUMER, PACT_DIR, PROVIDER } from './pact'

const { eachLike, integer, like, regex } = MatchersV3

const jsonContentType = regex('application/json.*', 'application/json; charset=utf-8')

const provider = new PactV3({
    consumer: CONSUMER,
    provider: PROVIDER,
    dir: PACT_DIR,
    logLevel: 'warn',
})

describe(`${CONSUMER} → ${PROVIDER}`, () => {
    it('should read an existing order by id', async () => {
        provider
            .given('order with id 1 exists')
            .uponReceiving('a request for order 1')
            .withRequest({ method: 'GET', path: '/orders/1' })
            .willRespondWith({
                status: 200,
                headers: { 'Content-Type': jsonContentType },
                body: {
                    id: like('1'),
                    created_at: regex('^\\d{4}-\\d{2}-\\d{2}T.*Z$', '2026-09-24T10:00:00.000Z'),
                    status: regex('^(pending|paid|cancelled)$', 'paid'),
                    items: eachLike({
                        product_id: like('1'),
                        quantity: integer(1),
                        price_cents: integer(149900),
                    }),
                    total_cents: integer(149900),
                },
            })

        await provider.executeTest(async (mockServer) => {
            const response = await fetch(`${mockServer.url}/orders/1`)
            const order = await response.json()

            expect(response.status).toBe(200)
            expect(order.id).toBe('1')
            expect(order.items).toHaveLength(1)
            expect(order.total_cents).toBe(149900)
        })
    })

    it('should list products', async () => {
        provider
            .given('products exist')
            .uponReceiving('a request for the product list')
            .withRequest({ method: 'GET', path: '/products' })
            .willRespondWith({
                status: 200,
                headers: { 'Content-Type': jsonContentType },
                body: {
                    items: eachLike({
                        id: like('1'),
                        name: like('Електрочайник Tefal TF-1008'),
                        price_cents: integer(149900),
                    }),
                    next_cursor: null,
                },
            })

        await provider.executeTest(async (mockServer) => {
            const response = await fetch(`${mockServer.url}/products`)
            const list = await response.json()

            expect(response.status).toBe(200)
            expect(list.items[0].name).toBeDefined()
            expect(list.next_cursor).toBeNull()
        })
    })
})
