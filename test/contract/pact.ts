import path from 'node:path'

export const CONSUMER = 'marketplace-frontend'
export const PROVIDER = 'marketplace-api'
export const PACT_DIR = path.resolve(process.cwd(), 'pacts')
export const PACT_FILE = path.join(PACT_DIR, `${CONSUMER}-${PROVIDER}.json`)
