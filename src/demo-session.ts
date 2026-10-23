import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AppModule } from './app.module'
import { configureApp } from './http/configure-app'
import { User } from './entities/user.entity'
import { DEMO_BUYER, printSummary } from './messaging/demo-support'
import { connectState } from './redis/redis'
import { sessionKey } from './services/session.service'
import type { Session } from './services/session.service'

const WAIT_MS = 2000

type Reply = {
    status: number
    body: Session
}

const startApp = async (): Promise<{ app: INestApplication; url: string }> => {
    const app = configureApp(await NestFactory.create(AppModule, { logger: false }))

    await app.listen(0)

    const { port } = app.getHttpServer().address() as AddressInfo

    return { app, url: `http://127.0.0.1:${port}` }
}

const send = async (url: string, init?: RequestInit): Promise<Reply> => {
    const response = await fetch(url, init)

    return { status: response.status, body: (await response.json()) as Session }
}

const main = async (): Promise<number> => {
    const state = connectState()
    const replies: Reply[] = []
    let running: INestApplication | null = null
    let token: string | null = null

    try {
        const first = await startApp()

        running = first.app

        const users = first.app.get(DataSource).getRepository(User)

        await users.upsert(DEMO_BUYER, ['email'])

        const buyer = await users.findOneByOrFail({ email: DEMO_BUYER.email })

        replies.push(
            await send(`${first.url}/sessions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ user_id: buyer.id }),
            }),
        )

        token = replies[0].body.token

        replies.push(await send(`${first.url}/sessions/me`, { headers: { 'x-session-token': token } }))

        await first.app.close()
        running = null

        const second = await startApp()

        running = second.app

        await sleep(WAIT_MS)

        const ttlBefore = await state.ttl(sessionKey(token))

        replies.push(await send(`${second.url}/sessions/me`, { headers: { 'x-session-token': token } }))

        const ttlAfter = await state.ttl(sessionKey(token))
        const inRedis = await state.exists(sessionKey(token))

        const summary = {
            requests: replies.length,
            sessions: new Set(replies.map((reply) => reply.body.token)).size,
            'in-redis': inRedis === 1 ? 1 : 0,
            'ttl-before': ttlBefore,
            'ttl-after': ttlAfter,
            'ttl-renewed': ttlAfter > ttlBefore ? 1 : 0,
        }

        printSummary(summary)

        const ok =
            replies.every((reply) => reply.status === 200 || reply.status === 201) &&
            summary.requests >= 3 &&
            summary.sessions === 1 &&
            summary['in-redis'] === 1 &&
            summary['ttl-renewed'] === 1

        return ok ? 0 : 1
    } finally {
        if (token) {
            await state.del(sessionKey(token))
        }

        if (running) {
            await running.close()
        }

        await state.quit()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })