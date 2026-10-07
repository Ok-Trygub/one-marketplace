import { io } from 'socket.io-client'

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

const connect = (userId) =>
    new Promise((resolve, reject) => {
        const socket = io(BASE_URL, { auth: { userId }, forceNew: true })

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
    const { items: orders } = await request('/orders?limit=100')
    const orderA = orders.find((order) => order.status !== 'cancelled')
    const orderB = orders.find((order) => order.id !== orderA?.id)

    if (!orderA || !orderB) {
        fail('The demo needs two orders, one of them not cancelled. Run npm run seed first.')
    }

    const roomB = sameRoom ? orderA : orderB
    const expectedB = sameRoom ? 1 : 0

    const clientA = await connect(orderA.user_id)
    const clientB = await connect(roomB.user_id)

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
        headers: { 'Content-Type': 'application/json' },
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
