import { readFileSync } from 'node:fs'
import { envSchema } from '../dist/src/config/env.schema.js'


const envExample = readFileSync('.env.example', 'utf8')
const expectedVariables = Object.keys(envSchema.shape)

const actualVariables = envExample
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter(Boolean)

const expected = new Set(expectedVariables)
const actual = new Set(actualVariables)

const missing = expectedVariables.filter(
    (name) => !actual.has(name),
)

const extra = actualVariables.filter(
    (name) => !expected.has(name),
)

if (missing.length > 0 || extra.length > 0) {
    console.error('✗ .env.example is out of sync with env schema')

    if (missing.length > 0) {
        console.error(`Missing: ${missing.join(', ')}`)
    }

    if (extra.length > 0) {
        console.error(`Extra: ${extra.join(', ')}`)
    }

    process.exit(1)
}

console.log('✓ .env.example is in sync with env schema')