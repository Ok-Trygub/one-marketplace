import type { Redis } from 'ioredis'

export const cacheGet = async (redis: Redis, key: string): Promise<string | null> => {
    try {
        return await redis.get(key)
    } catch {
        return null
    }
}

export const cacheSet = async (
    redis: Redis,
    key: string,
    value: string,
    ttlSeconds: number,
): Promise<void> => {
    try {
        await redis.set(key, value, 'EX', ttlSeconds)
    } catch {
        return
    }
}