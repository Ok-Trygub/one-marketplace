import { generateKeyPairSync, randomBytes } from 'node:crypto'

process.env.PORT ??= '5001'
process.env.BROKER_URL ??= 'amqp://placeholder:placeholder@127.0.0.1:5672'
process.env.REDIS_URL ??= 'redis://127.0.0.1:6390'
process.env.REDIS_QUEUE_URL ??= 'redis://127.0.0.1:6391'

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
    const pair = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    })

    process.env.JWT_PRIVATE_KEY = Buffer.from(pair.privateKey).toString('base64')
    process.env.JWT_PUBLIC_KEY = Buffer.from(pair.publicKey).toString('base64')
}

process.env.JWT_KID ??= 'test'
process.env.REFRESH_TOKEN_PEPPER ??= randomBytes(32).toString('base64')