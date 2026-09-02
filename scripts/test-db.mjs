import { pool } from '../dist/src/db/pool.js'

try {
    const result = await pool.query('SELECT current_user, current_database()')

    console.log(result.rows[0])
} finally {
    await pool.end()
}