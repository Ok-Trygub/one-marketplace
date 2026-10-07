import type { AddressInfo } from 'node:net'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/http/configure-app'
import type { OrderResponse } from '../../src/controllers/orders.controller'
import type { JoinAck } from '../../src/gateways/orders.gateway'
import type { OrderStatusEvent } from '../../src/services/order-events.service'
import { startTestDatabase } from '../integration/testkit/database'
import type { TestDatabase } from '../integration/testkit/database'
import { insertProduct, insertUser } from '../integration/testkit/builders'

describe('order status realtime (e2e)', () => {
    let database: TestDatabase
    let app: INestApplication
    let baseUrl: string
    let sockets: Socket[] = []
    let orderSequence = 0

    const createOrder = async (): Promise<OrderResponse> => {
        const buyer = await insertUser(database.dataSource)
        const product = await insertProduct(database.dataSource)

        orderSequence += 1

        const response = await request(baseUrl)
            .post('/orders')
            .set('Idempotency-Key', `realtime-order-${orderSequence}`)
            .send({ user_id: buyer.id, items: [{ product_id: product.id, quantity: 1 }] })
            .expect(201)

        return response.body
    }

    const changeStatus = (orderId: string, status: string): request.Test => {
        return request(baseUrl).patch(`/orders/${orderId}/status`).send({ status })
    }

    const connect = (userId?: string): Promise<Socket> => {
        return new Promise((resolve, reject) => {
            const socket = io(baseUrl, { auth: userId ? { userId } : {}, forceNew: true })

            sockets.push(socket)
            socket.once('connect', () => resolve(socket))
            socket.once('connect_error', reject)
        })
    }

    const join = (socket: Socket, orderId: string): Promise<JoinAck> => {
        return socket.timeout(2000).emitWithAck('join', { orderId })
    }

    const collectEvents = (socket: Socket): OrderStatusEvent[] => {
        const events: OrderStatusEvent[] = []

        socket.on('order.status', (event: OrderStatusEvent) => events.push(event))

        return events
    }

    const readStream = async (
        order: OrderResponse,
        expectedEvents: number,
        headers: Record<string, string> = {},
    ): Promise<{ contentType: string | null; text: string }> => {
        const controller = new AbortController()
        const response = await fetch(`${baseUrl}/orders/${order.id}/events`, {
            headers: { 'X-User-Id': order.user_id, ...headers },
            signal: controller.signal,
        })
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let text = ''

        while ((text.match(/^id:/gm) ?? []).length < expectedEvents) {
            const { done, value } = await reader.read()

            if (done) {
                break
            }

            text += decoder.decode(value, { stream: true })
        }

        controller.abort()

        return { contentType: response.headers.get('content-type'), text }
    }

    const eventIds = (text: string): number[] => {
        return (text.match(/^id: \d+$/gm) ?? []).map((line) => Number(line.slice(4)))
    }

    beforeAll(async () => {
        database = await startTestDatabase()
        process.env.DATABASE_URL = database.container.getConnectionUri()

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

        app = configureApp(moduleRef.createNestApplication())

        await app.listen(0, '127.0.0.1')

        const { port } = app.getHttpServer().address() as AddressInfo

        baseUrl = `http://127.0.0.1:${port}`
    })

    afterEach(() => {
        sockets.forEach((socket) => socket.close())
        sockets = []
    })

    afterAll(async () => {
        await app?.close()
        await database?.stop()
    })

    it('should change the status and return the updated order', async () => {
        const order = await createOrder()

        const response = await changeStatus(order.id, 'pending').expect(200)

        expect(response.body).toMatchObject({ id: order.id, user_id: order.user_id, status: 'pending' })
    })

    it('should return 409 for a transition that is not allowed', async () => {
        const order = await createOrder()

        const same = await changeStatus(order.id, 'paid').expect(409)

        expect(same.headers['content-type']).toContain('application/problem+json')

        await changeStatus(order.id, 'cancelled').expect(200)
        await changeStatus(order.id, 'paid').expect(409)
    })

    it('should return 404 for an unknown order and 400 for an unknown status', async () => {
        const order = await createOrder()

        await changeStatus('999999', 'pending').expect(404)
        await changeStatus(order.id, 'shipped').expect(400)
    })

    it('should deliver order.status only to the room of the changed order', async () => {
        const orderA = await createOrder()
        const orderB = await createOrder()
        const clientA = await connect(orderA.user_id)
        const clientB = await connect(orderB.user_id)
        const eventsA = collectEvents(clientA)
        const eventsB = collectEvents(clientB)

        expect(await join(clientA, orderA.id)).toEqual({ ok: true, room: `orders:${orderA.id}` })
        expect(await join(clientB, orderB.id)).toEqual({ ok: true, room: `orders:${orderB.id}` })

        await changeStatus(orderA.id, 'pending').expect(200)
        await changeStatus(orderB.id, 'pending').expect(200)

        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(eventsA).toEqual([expect.objectContaining({ id: 1, orderId: orderA.id, status: 'pending' })])
        expect(eventsB).toEqual([expect.objectContaining({ id: 1, orderId: orderB.id, status: 'pending' })])
    })

    it('should reject join for an anonymous client, a stranger and an unknown order', async () => {
        const order = await createOrder()
        const stranger = await insertUser(database.dataSource)
        const anonymousClient = await connect()
        const strangerClient = await connect(stranger.id)
        const strangerEvents = collectEvents(strangerClient)

        expect(await join(anonymousClient, order.id)).toEqual({ ok: false, error: 'UNAUTHORIZED' })
        expect(await join(strangerClient, order.id)).toEqual({ ok: false, error: 'FORBIDDEN' })
        expect(await join(strangerClient, '999999')).toEqual({ ok: false, error: 'ORDER_NOT_FOUND' })

        await changeStatus(order.id, 'pending').expect(200)

        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(strangerEvents).toEqual([])
    })

    it('should stream status changes as server-sent events', async () => {
        const order = await createOrder()
        const pending = readStream(order, 1)

        await new Promise((resolve) => setTimeout(resolve, 300))
        await changeStatus(order.id, 'pending').expect(200)

        const stream = await pending

        expect(stream.contentType).toBe('text/event-stream')
        expect(stream.text).toContain('retry: 1000\n\n')
        expect(stream.text).toContain('id: 1\nevent: order.status\ndata: {')
        expect(stream.text).toContain('"status":"pending"')
    })

    it('should replay only the events after Last-Event-ID', async () => {
        const order = await createOrder()

        for (const status of ['pending', 'paid', 'pending', 'paid']) {
            await changeStatus(order.id, status).expect(200)
        }

        const stream = await readStream(order, 1, { 'Last-Event-ID': '3' })

        expect(eventIds(stream.text)).toEqual([4])
    })

    it('should not replay history without Last-Event-ID', async () => {
        const order = await createOrder()

        await changeStatus(order.id, 'pending').expect(200)
        await changeStatus(order.id, 'paid').expect(200)

        const pending = readStream(order, 1)

        await new Promise((resolve) => setTimeout(resolve, 300))
        await changeStatus(order.id, 'pending').expect(200)

        const stream = await pending

        expect(eventIds(stream.text)).toEqual([3])
    })

    it('should refuse the event stream to an anonymous client and to a stranger', async () => {
        const order = await createOrder()
        const stranger = await insertUser(database.dataSource)

        const anonymous = await request(baseUrl).get(`/orders/${order.id}/events`).expect(401)

        expect(anonymous.headers['content-type']).toContain('application/problem+json')

        await request(baseUrl)
            .get(`/orders/${order.id}/events`)
            .set('X-User-Id', stranger.id)
            .expect(403)
    })

    it('should return 404 for the event stream of an unknown order', async () => {
        const stranger = await insertUser(database.dataSource)
        const response = await request(baseUrl)
            .get('/orders/999999/events')
            .set('X-User-Id', stranger.id)
            .expect(404)

        expect(response.headers['content-type']).toContain('application/problem+json')
    })
})
