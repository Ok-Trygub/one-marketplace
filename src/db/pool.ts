import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import path from 'node:path'

const SECRET_FILE = path.resolve(
    process.cwd(),
    'secrets/db_password'
)

export const pool = new Pool({
    host: 'postgres',
    port: 5432,
    database: 'marketplace',
    user: 'app_user',

    password: async () => {
        return (await readFile(SECRET_FILE, 'utf8')).trim()
    },
})

pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error)
})