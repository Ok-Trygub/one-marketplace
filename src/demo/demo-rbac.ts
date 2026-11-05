import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Order } from '../entities/order.entity'
import { AUTH_DEMO_PRODUCT, finish, prepareAuthUsers, runDemo, startDemoApp } from './auth-demo-support'
import type { DemoApp } from './auth-demo-support'

const forgeRole = (token: string, role: string): string => {
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

    payload.role = role
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')

    return parts.join('.')
}

const createProduct = (demo: DemoApp, token: string) =>
    demo.call('/products', {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': randomUUID() },
        body: { name: AUTH_DEMO_PRODUCT, price_cents: 1000, stock: 1 },
    })

const main = async (): Promise<number> => {
    const demo = await startDemoApp()

    try {
        const { owner, stranger, seller } = await prepareAuthUsers(demo.dataSource)

        const order = await demo.dataSource.getRepository(Order).save({ userId: owner.id, status: 'paid', total: 0 })
        const ownerToken = String((await demo.login(owner)).body.access_token)
        const strangerToken = String((await demo.login(stranger)).body.access_token)
        const sellerToken = String((await demo.login(seller)).body.access_token)

        const anon = await demo.call(`/orders/${order.id}`)
        const own = await demo.call(`/orders/${order.id}`, { token: ownerToken })
        const foreign = await demo.call(`/orders/${order.id}`, { token: strangerToken })
        const roleDenied = await createProduct(demo, ownerToken)
        const tampered = await createProduct(demo, forgeRole(ownerToken, 'admin'))
        const roleAllowed = await createProduct(demo, sellerToken)

        return finish(
            {
                anon: anon.status,
                own: own.status,
                foreign: foreign.status,
                'role-denied': roleDenied.status,
                'role-allowed': roleAllowed.status,
                tampered: tampered.status,
            },
            {
                anon: [401],
                own: [200],
                foreign: [403],
                'role-denied': [403],
                'role-allowed': [200, 201],
                tampered: [401],
            },
        )
    } finally {
        await demo.app.close()
    }
}

runDemo(main)
