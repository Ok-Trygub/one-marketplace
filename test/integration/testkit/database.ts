import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { DataSource } from 'typeorm'
import { buildDataSourceOptions } from '../../../src/database/options'

export type TestDatabase = {
    container: StartedPostgreSqlContainer
    dataSource: DataSource
    truncate: () => Promise<void>
    stop: () => Promise<void>
}

export const POSTGRES_IMAGE = 'postgres:16-alpine'

export const startTestDatabase = async (): Promise<TestDatabase> => {
    const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
    const dataSource = new DataSource(
        buildDataSourceOptions({ url: container.getConnectionUri() }),
    )

    await dataSource.initialize()
    await dataSource.runMigrations()

    return {
        container,
        dataSource,
        truncate: async () => {
            await dataSource.query(
                'TRUNCATE TABLE order_items, orders, jobs, products, users RESTART IDENTITY CASCADE',
            )
        },
        stop: async () => {
            await dataSource.destroy()
            await container.stop()
        },
    }
}
