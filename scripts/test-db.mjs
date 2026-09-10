import { validate } from '../dist/src/config/env.schema.js'
import { createPool } from '../dist/src/db/pool.js'

const env = validate(process.env)
const pool = createPool(env.DB_URL, {
    passwordFile: env.DB_PASSWORD_FILE,
    connectionTimeoutMillis: env.TIMEOUT_MS,
})

try {
    const result = await pool.query('SELECT current_user, current_database()')

    console.log(result.rows[0])
} finally {
    await pool.end()
}
