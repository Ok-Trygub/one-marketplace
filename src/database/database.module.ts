import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Module } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { buildDataSourceOptions } from './options'
import type { DatabaseConnection } from './options'
import type { Env } from '../config/env.schema'

const connectionFromConfig = async (
    config: ConfigService<Env, true>,
): Promise<DatabaseConnection> => {
    const url = process.env.DATABASE_URL

    if (url) {
        return { url }
    }

    const dbUrl = config.get('DB_URL', { infer: true })

    if (!dbUrl) {
        throw new Error('Either DATABASE_URL or DB_URL must be set')
    }

    const { hostname, port, pathname, username } = new URL(dbUrl)
    const passwordFile = path.resolve(process.cwd(), config.get('DB_PASSWORD_FILE', { infer: true }))
    const password = (await readFile(passwordFile, 'utf8')).trim()

    return {
        host: hostname,
        port: Number(port) || 5432,
        username: decodeURIComponent(username),
        password,
        database: pathname.slice(1),
    }
}

class DataSourceLifecycle implements OnModuleDestroy {
    constructor(private readonly dataSource: DataSource) {}

    onModuleDestroy(): Promise<void> {
        return this.dataSource.destroy()
    }
}

@Module({
    providers: [
        {
            provide: DataSource,
            inject: [ConfigService],
            useFactory: async (config: ConfigService<Env, true>) => {
                const dataSource = new DataSource({
                    ...buildDataSourceOptions(await connectionFromConfig(config)),
                    connectTimeoutMS: config.get('TIMEOUT_MS', { infer: true }),
                })

                return dataSource.initialize()
            },
        },
        {
            provide: DataSourceLifecycle,
            inject: [DataSource],
            useFactory: (dataSource: DataSource) => new DataSourceLifecycle(dataSource),
        },
    ],
    exports: [DataSource],
})
export class DatabaseModule {}
