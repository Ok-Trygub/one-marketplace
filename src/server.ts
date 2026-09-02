import express from 'express'
import * as OpenApiValidator from 'express-openapi-validator'
import path from 'node:path'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'

import productsRouter from './routes/products.routes'
import ordersRouter from './routes/orders.routes'
import { errorHandler } from './middleware/error-handler'
import { createPool } from './db/pool'
import { AppConfigModule } from './config/config.module'
import type { Env } from './config/env.schema'

async function bootstrap() {
    const configContext = await NestFactory.createApplicationContext(
        AppConfigModule,
    )

    const configService = configContext.get<ConfigService<Env, true>>(
        ConfigService,
    )

    const port = configService.get('PORT')
    const pool = createPool(configService.get('DB_URL'))

    const app = express()

    app.use(express.json())

    app.get('/health', async (_req, res) => {
        try {
            const result = await pool.query('SELECT 1 AS ok')

            res.status(200).json({
                status: 'ok',
                database: result.rows[0].ok === 1,
                uptime: process.uptime(),
            })
        } catch (error) {
            console.error('Health check failed:', error)

            res.status(503).json({
                status: 'error',
                database: false,
            })
        }
    })

    app.use(
        OpenApiValidator.middleware({
            apiSpec: path.join(process.cwd(), 'openapi/openapi.yaml'),
            validateRequests: true,
            validateResponses: true,
        }),
    )

    app.use('/products', productsRouter)
    app.use('/orders', ordersRouter)

    app.use(errorHandler)

    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`)
    })
}

bootstrap()