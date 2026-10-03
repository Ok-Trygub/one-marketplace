import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { buildDataSourceOptions } from './database/options'
import type { DatabaseConnection } from './database/options'

const env = (name: string): string => {
    const value = process.env[name]

    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

export const connectionFromEnv = (): DatabaseConnection => {
    const url = process.env.DATABASE_URL

    if (url) {
        return { url }
    }

    return {
        host: env('DB_HOST'),
        port: Number(env('DB_PORT')),
        username: env('DB_USER'),
        password: env('DB_PASSWORD'),
        database: env('DB_NAME'),
    }
}

export const dataSourceOptions = buildDataSourceOptions(connectionFromEnv())

export const AppDataSource = new DataSource(dataSourceOptions)
