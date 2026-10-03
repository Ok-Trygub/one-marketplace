import { execSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { Verifier } from '@pact-foundation/pact'
import type { VerifierOptions } from '@pact-foundation/pact'
import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/http/configure-app'
import { startTestDatabase } from '../integration/testkit/database'
import type { TestDatabase } from '../integration/testkit/database'
import { PACT_FILE, PROVIDER } from './pact'

const providerVersion = (): string => {
    if (process.env.PACT_VERSION) {
        return process.env.PACT_VERSION
    }

    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim()
    } catch {
        return 'local'
    }
}

const pactSource = (): Partial<VerifierOptions> => {
    const brokerUrl = process.env.PACT_BROKER_URL

    if (!brokerUrl) {
        return { pactUrls: [PACT_FILE] }
    }

    return {
        pactBrokerUrl: brokerUrl,
        ...(process.env.PACT_BROKER_TOKEN ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN } : {}),
        publishVerificationResult: true,
        consumerVersionSelectors: [{ latest: true }],
    }
}

describe(`${PROVIDER} provider verification`, () => {
    let database: TestDatabase
    let app: INestApplication
    let providerBaseUrl: string

    beforeAll(async () => {
        database = await startTestDatabase()
        process.env.DATABASE_URL = database.container.getConnectionUri()

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

        app = configureApp(moduleRef.createNestApplication())

        await app.listen(0, '127.0.0.1')

        const { port } = app.getHttpServer().address() as AddressInfo

        providerBaseUrl = `http://127.0.0.1:${port}`
    })

    afterAll(async () => {
        await app?.close()
        await database?.stop()
    })

    it('should satisfy every interaction of the consumer contract', async () => {
        const seedBuyerAndProduct = async () => {
            await database.dataSource.query(
                `INSERT INTO users (id, email, phone, name, balance)
                 OVERRIDING SYSTEM VALUE
                 VALUES (1, 'pact-buyer@example.com', '+380500000001', 'Pact Buyer', 1000000000)
                 ON CONFLICT (id) DO NOTHING`,
            )
            await database.dataSource.query(
                `INSERT INTO products (id, name, description, price, stock)
                 OVERRIDING SYSTEM VALUE
                 VALUES (1, 'Електрочайник Tefal TF-1008', 'Електрочайник зі скла на 1,7 літра', 149900, 10)
                 ON CONFLICT (id) DO NOTHING`,
            )
        }

        const output = await new Verifier({
            provider: PROVIDER,
            providerBaseUrl,
            providerVersion: providerVersion(),
            logLevel: 'warn',
            stateHandlers: {
                'products exist': seedBuyerAndProduct,
                'order with id 1 exists': async () => {
                    await seedBuyerAndProduct()
                    await database.dataSource.query(
                        `INSERT INTO orders (id, user_id, status, total)
                         OVERRIDING SYSTEM VALUE
                         VALUES (1, 1, 'paid', 149900)
                         ON CONFLICT (id) DO NOTHING`,
                    )
                    await database.dataSource.query(
                        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
                         OVERRIDING SYSTEM VALUE
                         VALUES (1, 1, 1, 1, 149900)
                         ON CONFLICT (id) DO NOTHING`,
                    )
                },
            },
            ...pactSource(),
        }).verifyProvider()

        console.log(output)
    })
})
