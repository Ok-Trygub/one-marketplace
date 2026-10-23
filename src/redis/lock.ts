import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`

export const acquireLock = async (redis: Redis, key: string, ttlMs: number): Promise<string | null> => {
    const token = randomUUID()
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX')

    return result === 'OK' ? token : null
}

export const releaseLock = async (redis: Redis, key: string, token: string): Promise<boolean> => {
    const deleted = await redis.eval(RELEASE_SCRIPT, 1, key, token)

    return deleted === 1
}