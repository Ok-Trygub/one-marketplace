import { io } from 'socket.io-client'
import {
    SEED_BUYER_EMAIL,
    SEED_OTHER_BUYER_EMAIL,
    SEED_PASSWORD,
    SEED_SELLER_EMAIL,
} from '../dist/src/seed-credentials.js'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const WAIT_MS = 1000
const sameRoom = process.argv.includes('--same-room')

const fail = (message) => {
    console.error(message)
    process.exit(1)
}

const request = async (path, options) => {
    const response = await fetch(`${BASE_URL}${path}`, options)

    if (!response.ok) {
        throw new Error(`${options?.method ?? 'GET'} ${path} responded with ${response.status}`)
    }

    return response.json()
}

const login = async (email) => {
    const { access_token: accessToken } = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: SEED_PASSWORD }),
    })

    return accessToken
}

const ownOrders = async (token) => {
    const { items } = await request('/orders?limit=100', { headers: { Authorization: `Bearer ${token}` } })

    return items
}

const connect = (token) =>
    new Promise((resolve, reject) => {
        const socket = io(BASE_URL, { auth: { token }, forceNew: true })

        socket.once('connect', () => resolve(socket))
        socket.once('connect_error', (error) => reject(new Error(`socket connection failed: ${error.message}`)))
    })

const join = async (socket, orderId) => {
    const ack = await socket.timeout(WAIT_MS).emitWithAck('join', { orderId })

    if (!ack.ok) {
        throw new Error(`join to order ${orderId} was rejected: ${ack.error}`)
    }
}

const main = async () => {
    const buyerA = await login(SEED_BUYER_EMAIL)
    const buyerB = await login(SEED_OTHER_BUYER_EMAIL)
    const seller = await login(SEED_SELLER_EMAIL)

    const orderA = (await ownOrders(buyerA)).find((order) => order.status !== 'cancelled')
    const orderB = (await ownOrders(buyerB))[0]

    if (!orderA || !orderB) {
        fail('The demo needs an order of each seed buyer, one of them not cancelled. Run npm run seed first.')
    }

    const roomB = sameRoom ? orderA : orderB
    const tokenB = sameRoom ? buyerA : buyerB
    const expectedB = sameRoom ? 1 : 0

    const clientA = await connect(buyerA)
    const clientB = await connect(tokenB)

    let receivedA = 0
    let receivedB = 0

    clientA.on('order.status', () => {
        receivedA += 1
    })
    clientB.on('order.status', () => {
        receivedB += 1
    })

    await join(clientA, orderA.id)
    await join(clientB, roomB.id)

    await request(`/orders/${orderA.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller}` },
        body: JSON.stringify({ status: orderA.status === 'paid' ? 'pending' : 'paid' }),
    })

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))

    clientA.close()
    clientB.close()

    console.log(`A_RECEIVED=${receivedA}`)
    console.log(`B_RECEIVED=${receivedB}`)

    process.exit(receivedA === 1 && receivedB === expectedB ? 0 : 1)
}

main().catch((error) => fail(`realtime-demo failed: ${error.message}`))
