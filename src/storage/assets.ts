import { createHash } from 'node:crypto'
import type { StorageService } from './storage.service'

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export const ASSETS_PREFIX = 'assets/'

export const contentHash = (body: Buffer): string => createHash('sha256').update(body).digest('hex').slice(0, 8)

export const assetKeyFor = (name: string, extension: string, body: Buffer): string =>
    `${ASSETS_PREFIX}${name}.${contentHash(body)}.${extension}`

export const publishAsset = async (
    storage: StorageService,
    name: string,
    extension: string,
    body: Buffer,
    contentType: string,
): Promise<string> => {
    const key = assetKeyFor(name, extension, body)

    await storage.putObject(key, body, contentType, IMMUTABLE_CACHE_CONTROL)

    return key
}