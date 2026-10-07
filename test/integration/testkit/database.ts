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
            const tables = await dataSource.query<{ table_name: string }[]>(
                `SELECT table_name
                 FROM information_schema.tables
                 WHERE table_schema = 'public'
                   AND table_type = 'BASE TABLE'
                   AND table_name NOT IN ('migrations', 'typeorm_metadata')`,
            )
            const names = tables.map(({ table_name }) => `"${table_name}"`).join(', ')

            await dataSource.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`)
        },
        stop: async () => {
            await dataSource.destroy()
            await container.stop()
        },
    }
}
