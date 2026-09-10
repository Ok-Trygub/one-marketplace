import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SECRET_FILE = path.resolve(process.cwd(), 'secrets/db_password')

const password = process.env.DB_PASSWORD

if (!password) {
    console.error('✗ DB_PASSWORD is not provided. Run through `infisical run`.')
    process.exit(1)
}

if (existsSync(SECRET_FILE) && !process.argv.includes('--force')) {
    console.error(
        `✗ ${SECRET_FILE} already exists. Rotation keeps the current password in this file, ` +
            'so seeding it again would break authentication. Pass --force to overwrite.',
    )
    process.exit(1)
}

writeFileSync(SECRET_FILE, `${password}\n`)

console.log(`✓ ${SECRET_FILE} written from Infisical DB_PASSWORD`)
