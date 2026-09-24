import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { configureApp } from './http/configure-app'
import type { Env } from './config/env.schema'

async function bootstrap() {
    const app = configureApp(await NestFactory.create(AppModule))
    const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true })

    app.enableShutdownHooks()

    await app.listen(port)

    console.log(`Server running on http://localhost:${port}`)
}

bootstrap().catch((error) => {
    console.error('Failed to start the application:', error)
    process.exit(1)
})
