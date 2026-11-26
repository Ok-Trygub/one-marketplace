import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [namespace, secretName, ...files] = process.argv.slice(2)

if (!namespace || !secretName || files.length === 0) {
    console.error('usage: node scripts/secret-occurrences.mjs <namespace> <secret> <file>...')
    process.exit(2)
}

const secret = JSON.parse(execFileSync('kubectl', ['-n', namespace, 'get', 'secret', secretName, '-o', 'json'], { encoding: 'utf8' }))
const values = Object.values(secret.data ?? {})
    .map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'))
    .filter((value) => value.length >= 8)

for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const count = values.reduce((sum, value) => sum + text.split(value).length - 1, 0)

    console.log(`${file}=${count}`)
}
