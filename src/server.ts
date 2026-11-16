import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import type { NextFunction, Request, Response } from 'express'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { configureApp } from './http/configure-app'
import { Readiness } from './http/readiness'
import type { Env } from './config/env.schema'
import { StorageService } from './storage/storage.service'

async function bootstrap() {
    const app = configureApp(await NestFactory.create(AppModule))
    const config = app.get<ConfigService<Env, true>>(ConfigService)
    const port = config.get('PORT', { infer: true })
    const drainMs = config.get('SHUTDOWN_DRAIN_MS', { infer: true })
    const readiness = app.get(Readiness)

    app.use((_request: Request, response: Response, next: NextFunction) => {
        if (!readiness.isReady()) {
            response.setHeader('Connection', 'close')
        }

        next()
    })

    const shutdown = async (signal: string) => {
        readiness.startDraining()
        console.log(`${signal}: readiness is off, draining for ${drainMs}ms`)
        await sleep(drainMs)
        await new Promise<void>((resolve) => app.getHttpServer().close(() => resolve()))
        await app.close()
        console.log('Server closed')
        process.exit(0)
    }

    process.once('SIGTERM', () => void shutdown('SIGTERM'))
    process.once('SIGINT', () => void shutdown('SIGINT'))

    const storage = app.get(StorageService)
    const bucket = await storage.ensureBucket()

    console.log(`storage: bucket ${storage.bucket} ${bucket === 'created' ? 'created' : 'is ready'}`)

    await sleep(config.get('STARTUP_DELAY_MS', { infer: true }))
    await app.listen(port)
    readiness.markReady()

    console.log(`Server running on http://localhost:${port}`)
}

bootstrap().catch((error) => {
    console.error('Failed to start the application:', error)
    process.exit(1)
})
