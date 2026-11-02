import type { AddressInfo } from 'node:net'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AppModule } from '../app.module'
import { configureApp } from '../http/configure-app'
import { hashPassword } from '../auth/password'
import { Product } from '../entities/product.entity'
import { User } from '../entities/user.entity'
import type { UserRole } from '../entities/user.entity'

export const AUTH_DEMO_PASSWORD = 'auth-demo-password'

export const AUTH_DEMO_PRODUCT = 'Auth demo product'

const DEMO_USERS = {
    owner: { email: 'auth-demo-owner@example.com', phone: '+380990000801', name: 'Auth Demo Owner', role: 'buyer' },
    stranger: { email: 'auth-demo-stranger@example.com', phone: '+380990000802', name: 'Auth Demo Stranger', role: 'buyer' },
    seller: { email: 'auth-demo-seller@example.com', phone: '+380990000803', name: 'Auth Demo Seller', role: 'seller' },
} satisfies Record<string, { email: string; phone: string; name: string; role: UserRole }>

export type AuthDemoUsers = Record<keyof typeof DEMO_USERS, User>

export type DemoResponse = {
    status: number
    body: Record<string, unknown>
}

export type DemoApp = {
    app: INestApplication
    dataSource: DataSource
    call: (
        path: string,
        options?: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> },
    ) => Promise<DemoResponse>
    login: (user: User) => Promise<DemoResponse>
    refresh: (refreshToken: unknown) => Promise<DemoResponse>
}

export const startDemoApp = async (): Promise<DemoApp> => {
    const app = configureApp(await NestFactory.create(AppModule, { logger: false }))

    await app.listen(0, '127.0.0.1')

    const { port } = app.getHttpServer().address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${port}`

    const call: DemoApp['call'] = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await response.text()

        return { status: response.status, body: text ? JSON.parse(text) : {} }
    }

    return {
        app,
        dataSource: app.get(DataSource),
        call,
        login: (user) => call('/auth/login', { method: 'POST', body: { email: user.email, password: AUTH_DEMO_PASSWORD } }),
        refresh: (refreshToken) => call('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } }),
    }
}

export const prepareAuthUsers = async (dataSource: DataSource): Promise<AuthDemoUsers> => {
    const users = dataSource.getRepository(User)
    const passwordHash = await hashPassword(AUTH_DEMO_PASSWORD)
    const emails = Object.values(DEMO_USERS).map((user) => user.email)

    await users.upsert(
        Object.values(DEMO_USERS).map((user) => ({ ...user, balance: 1_000_000_000, passwordHash })),
        ['email'],
    )

    await dataSource.query(
        `DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
        [emails],
    )
    await dataSource.query(
        `DELETE FROM order_items WHERE order_id IN (SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id WHERE u.email = ANY($1))`,
        [emails],
    )
    await dataSource.query(`DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [emails])
    await dataSource.getRepository(Product).delete({ name: AUTH_DEMO_PRODUCT })

    return {
        owner: await users.findOneByOrFail({ email: DEMO_USERS.owner.email }),
        stranger: await users.findOneByOrFail({ email: DEMO_USERS.stranger.email }),
        seller: await users.findOneByOrFail({ email: DEMO_USERS.seller.email }),
    }
}

export const finish = (summary: Record<string, number>, expected: Record<string, number[]>): number => {
    for (const [key, value] of Object.entries(summary)) {
        console.log(`${key}=${value}`)
    }

    const broken = Object.entries(expected).filter(([key, allowed]) => !allowed.includes(summary[key]))

    for (const [key, allowed] of broken) {
        console.error(`invariant broken: ${key}=${summary[key]}, expected ${allowed.join(' or ')}`)
    }

    return broken.length === 0 ? 0 : 1
}

export const runDemo = (demo: () => Promise<number>): void => {
    demo()
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
