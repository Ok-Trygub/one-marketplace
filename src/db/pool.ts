import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import path from 'node:path'

const SECRET_FILE = path.resolve(
    process.cwd(),
    'secrets/db_password'
)

export const createPool = (dbUrl: string): Pool => {
    const { hostname, port, pathname, username } = new URL(dbUrl)

    const pool = new Pool({
        host: hostname,
        port: Number(port) || 5432,
        database: pathname.slice(1),
        user: decodeURIComponent(username),

        password: async () => {
            return (await readFile(SECRET_FILE, 'utf8')).trim()
        },
    })

    pool.on('error', (error) => {
        console.error('PostgreSQL pool error:', error)
    })

    return pool
}
