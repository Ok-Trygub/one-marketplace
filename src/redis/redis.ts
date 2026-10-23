import { Redis } from 'ioredis'

export const REDIS_CACHE = 'REDIS_CACHE'
export const REDIS_STATE = 'REDIS_STATE'

const env = (name: string): string => {
    const value = process.env[name]

    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

export const connectCache = (url: string = env('REDIS_URL')): Redis =>
    new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 })

export const connectState = (url: string = env('REDIS_QUEUE_URL')): Redis =>
    new Redis(url, { lazyConnect: true })

export const connectQueue = (url: string = env('REDIS_QUEUE_URL')): Redis =>
    new Redis(url, { maxRetriesPerRequest: null })