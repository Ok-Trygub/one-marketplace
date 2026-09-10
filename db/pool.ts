import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import path from 'node:path'

type CreatePoolOptions = {
    passwordFile: string
    connectionTimeoutMillis: number
}

export const createPool = (
    dbUrl: string,
    { passwordFile, connectionTimeoutMillis }: CreatePoolOptions
): Pool => {
    const { hostname, port, pathname, username } = new URL(dbUrl)
    const secretFile = path.resolve(process.cwd(), passwordFile)

    const pool = new Pool({
        host: hostname,
        port: Number(port) || 5432,
        database: pathname.slice(1),
        user: decodeURIComponent(username),
        connectionTimeoutMillis,

        password: async () => {
            return (await readFile(secretFile, 'utf8')).trim()
        },
    })

    pool.on('error', (error) => {
        console.error('PostgreSQL pool error:', error)
    })

    return pool
}
