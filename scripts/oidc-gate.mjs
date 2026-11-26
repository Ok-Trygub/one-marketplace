import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        'token-file': { type: 'string' },
        policy: { type: 'string' },
        issuer: { type: 'string' },
        audience: { type: 'string' },
    },
})

if (!values['token-file'] || !values.policy) {
    console.error('usage: node scripts/oidc-gate.mjs --token-file <file> --policy <file> [--issuer <url>] [--audience <aud>]')
    process.exit(2)
}

const policy = JSON.parse(readFileSync(values.policy, 'utf8'))
const issuer = values.issuer ?? policy.iss
const audience = values.audience ?? policy.aud
const allowedSubjects = Array.isArray(policy.sub) ? policy.sub : [policy.sub]
const token = readFileSync(values['token-file'], 'utf8').trim()
const [encodedHeader = '', encodedPayload = '', encodedSignature = ''] = token.split('.')
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
const header = decode(encodedHeader)
const claims = decode(encodedPayload)

const fetchJson = async (url) => {
    const response = await fetch(url)

    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`)
    }

    return response.json()
}

const verifySignature = async () => {
    if (header.alg !== 'RS256') {
        return { verified: false, reason: `unsupported alg ${header.alg}` }
    }

    const discovery = await fetchJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)

    if (discovery.issuer !== issuer) {
        return { verified: false, reason: `discovery issuer ${discovery.issuer} differs from ${issuer}` }
    }

    const { keys = [] } = await fetchJson(discovery.jwks_uri)
    const jwk = keys.find((key) => key.kid === header.kid)

    if (!jwk) {
        return { verified: false, reason: `no key ${header.kid} in ${discovery.jwks_uri}` }
    }

    const verified = verify(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(encodedSignature, 'base64url'),
    )

    return { verified, reason: verified ? 'signature matches the issuer key' : 'signature does not match the issuer key' }
}

const evaluatePolicy = () => {
    const now = Math.floor(Date.now() / 1000)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]

    if (claims.iss !== issuer) return `iss ${claims.iss} is not ${issuer}`
    if (!audiences.includes(audience)) return `aud ${audiences.join(',')} does not include ${audience}`
    if (!allowedSubjects.includes(claims.sub)) return `sub ${claims.sub} is not allowed by ${values.policy}`
    if (typeof claims.exp !== 'number' || claims.exp <= now) return 'token expired'
    if (typeof claims.nbf === 'number' && claims.nbf > now) return 'token not valid yet'

    return null
}

const signature = await verifySignature().catch((error) => ({ verified: false, reason: error.message }))
const denial = signature.verified ? evaluatePolicy() : 'signature not verified'
const allowed = denial === null

console.log(`iss=${claims.iss}`)
console.log(`aud=${Array.isArray(claims.aud) ? claims.aud.join(',') : claims.aud}`)
console.log(`sub=${claims.sub}`)
console.log(`sig-verified=${signature.verified ? 1 : 0}`)
console.log(`policy-allow=${allowed ? 1 : 0}`)
console.log(`reason=${allowed ? 'allowed' : denial === 'signature not verified' ? signature.reason : denial}`)

process.exit(allowed ? 0 : 1)
