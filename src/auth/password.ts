import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64

const SALT_BYTES = 16

const SCHEME = 'scrypt'

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)))
    })

export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(SALT_BYTES)
    const key = await derive(password, salt)

    return [SCHEME, salt.toString('base64'), key.toString('base64')].join(':')
}

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
    const [scheme, salt, key] = stored.split(':')

    if (scheme !== SCHEME || !salt || !key) {
        return false
    }

    const expected = Buffer.from(key, 'base64')
    const actual = await derive(password, Buffer.from(salt, 'base64'))

    return actual.length === expected.length && timingSafeEqual(actual, expected)
}