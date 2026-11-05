import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { ASSETS_PREFIX } from './storage/assets'
import { createStorageClient, storageBucketFromEnv, storageConnectionFromEnv } from './storage/storage-client'
import { StorageService } from './storage/storage.service'

type CachedObject = {
    body: Buffer
    headers: Record<string, string>
    expiresAt: number
}

const MAX_ENTRIES = 500
const MAX_CACHED_BYTES = 5 * 1024 * 1024
const ASSET_KEY = /^assets\/[A-Za-z0-9._-]+$/

const storage = new StorageService(createStorageClient(storageConnectionFromEnv()), storageBucketFromEnv())
const cache = new Map<string, CachedObject>()

const sharedMaxAge = (cacheControl: string | undefined): number => {
    const directives = (cacheControl ?? '').toLowerCase()

    if (!/\bpublic\b/.test(directives) || /\b(private|no-store|no-cache)\b/.test(directives)) {
        return 0
    }

    return Number(/\bmax-age=(\d+)/.exec(directives)?.[1] ?? 0)
}

const assetKeyOf = (url: string | undefined): string | null => {
    try {
        return decodeURIComponent(new URL(url ?? '/', 'http://edge').pathname.slice(1))
    } catch {
        return null
    }
}

const send = (response: ServerResponse, status: number, xCache: string, body: Buffer | string, headers = {}): void => {
    response.writeHead(status, { ...headers, 'X-Cache': xCache }).end(body)
}

const server = createServer(async (request, response) => {
    const key = assetKeyOf(request.url)

    if (request.method !== 'GET' || !key || !key.startsWith(ASSETS_PREFIX) || !ASSET_KEY.test(key)) {
        send(response, 404, 'MISS', 'not found')
        return
    }

    const cached = cache.get(key)

    if (cached && cached.expiresAt > Date.now()) {
        send(response, 200, 'HIT', cached.body, cached.headers)
        return
    }

    const object = await storage.getObject(key).catch((error: unknown) => {
        console.warn(`edge: origin fetch for ${key} failed: ${error instanceof Error ? error.message : error}`)
        return undefined
    })

    if (object === undefined) {
        send(response, 502, 'MISS', 'origin unavailable')
        return
    }

    if (!object) {
        send(response, 404, 'MISS', 'not found')
        return
    }

    const headers: Record<string, string> = {
        'Content-Type': object.contentType ?? 'application/octet-stream',
        ETag: object.etag,
        ...(object.cacheControl ? { 'Cache-Control': object.cacheControl } : {}),
    }
    const maxAge = sharedMaxAge(object.cacheControl)

    if (maxAge > 0 && object.size <= MAX_CACHED_BYTES) {
        cache.delete(key)
        cache.set(key, { body: object.body, headers, expiresAt: Date.now() + maxAge * 1000 })

        if (cache.size > MAX_ENTRIES) {
            cache.delete(cache.keys().next().value as string)
        }
    }

    send(response, 200, 'MISS', object.body, headers)
})

const port = Number(process.env.EDGE_PORT ?? 8080)

server.listen(port, () => console.log(`edge: listening on http://localhost:${port}, origin bucket ${storage.bucket}`))

const stop = () => server.close(() => process.exit(0))

process.once('SIGINT', stop)
process.once('SIGTERM', stop)