import { execFile } from 'node:child_process'
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const POLICY = 'oidc/policy.json'
const GATE = join(ROOT, 'scripts/oidc-gate.mjs')
const policy = JSON.parse(readFileSync(join(ROOT, POLICY), 'utf8'))
const allowedSub = Array.isArray(policy.sub) ? policy.sub[0] : policy.sub
const foreignSub = 'repo:attacker@1000001/one-marketplace@2000002:pull_request'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const kid = randomUUID()
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }

const server = createServer((request, response) => {
    const issuer = `http://127.0.0.1:${server.address().port}`
    const body =
        request.url === '/.well-known/openid-configuration'
            ? { issuer, jwks_uri: `${issuer}/jwks` }
            : request.url === '/jwks'
              ? { keys: [jwk] }
              : null

    response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body ?? {}))
})

await new Promise((done) => server.listen(0, '127.0.0.1', done))

const issuer = `http://127.0.0.1:${server.address().port}`
const work = mkdtempSync(join(tmpdir(), 'oidc-demo-'))
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const sign = (sub) => {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode({
        iss: issuer,
        aud: policy.aud,
        sub,
        iat: now,
        nbf: now - 5,
        exp: now + 300,
    })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')

    return `${unsigned}.${signature}`
}

const corruptSignature = (token) => {
    const [header, payload, signature] = token.split('.')
    const bytes = Buffer.from(signature, 'base64url')
    bytes[0] ^= 0xff

    return `${header}.${payload}.${bytes.toString('base64url')}`
}

const green = sign(allowedSub)
const cases = [
    ['green', green],
    ['foreign-sub', sign(foreignSub)],
    ['bad-signature', corruptSignature(green)],
]

try {
    for (const [name, token] of cases) {
        const tokenFile = join(work, `${name}.jwt`)
        writeFileSync(tokenFile, token)

        const output = await promisify(execFile)(process.execPath, [GATE, '--token-file', tokenFile, '--policy', POLICY, '--issuer', issuer], { cwd: ROOT })
            .then(({ stdout }) => stdout)
            .catch((error) => error.stdout)

        console.log(`case=${name}`)
        process.stdout.write(output)
    }
} finally {
    server.close()
    rmSync(work, { recursive: true, force: true })
}
