import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from './app.module'
import { configureApp } from './http/configure-app'
import { printSummary } from './messaging/demo-support'
import { connectState } from './redis/redis'
import { RATE_LIMIT, rateLimitKey } from './services/rate-limiter.service'

const INSTANCES = 2
const CLIENT = 'demo-ratelimit'
const PATH = '/products/1'

type Reply = {
    status: number
    retryAfter: string | null
}

const startApp = async (): Promise<{ app: INestApplication; url: string }> => {
    const app = configureApp(await NestFactory.create(AppModule, { logger: false }))

    await app.listen(0)

    const { port } = app.getHttpServer().address() as AddressInfo

    return { app, url: `http://127.0.0.1:${port}` }
}

const main = async (): Promise<number> => {
    const state = connectState()
    const pods: { app: INestApplication; url: string }[] = []

    try {
        pods.push(...(await Promise.all(Array.from({ length: INSTANCES }, () => startApp()))))

        await state.del(rateLimitKey(CLIENT))

        const replies: Reply[] = []

        for (let index = 0; index < RATE_LIMIT * INSTANCES; index += 1) {
            const pod = pods[index % pods.length]
            const response = await fetch(`${pod.url}${PATH}`, { headers: { 'x-user-id': CLIENT } })

            await response.arrayBuffer()

            replies.push({ status: response.status, retryAfter: response.headers.get('retry-after') })
        }

        const blocked = replies.filter((reply) => reply.status === 429)
        const lastBlocked = blocked.at(-1)

        const summary = {
            instances: pods.length,
            limit: RATE_LIMIT,
            requests: replies.length,
            allowed: replies.length - blocked.length,
            blocked: blocked.length,
            status: lastBlocked?.status ?? 0,
            'retry-after': lastBlocked?.retryAfter ? 1 : 0,
            'retry-after-seconds': Number(lastBlocked?.retryAfter ?? 0),
        }

        printSummary(summary)

        const ok =
            summary.instances >= 2 &&
            summary.allowed === summary.limit &&
            summary.blocked >= 1 &&
            summary.status === 429 &&
            summary['retry-after'] === 1

        return ok ? 0 : 1
    } finally {
        await state.del(rateLimitKey(CLIENT))
        await Promise.all(pods.map((pod) => pod.app.close()))
        await state.quit()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })