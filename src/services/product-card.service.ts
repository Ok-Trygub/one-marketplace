import { Inject, Injectable } from '@nestjs/common'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Redis } from 'ioredis'
import { REDIS_CACHE } from '../redis/redis'
import { cacheGet, cacheSet } from '../redis/cache'
import { acquireLock, releaseLock } from '../redis/lock'
import { ProductsRepository } from '../repositories/products.repository'

export type ProductCard = {
    id: string
    name: string
    price_cents: number
    stock: number
    units_sold: number
}

export const productCardKey = (id: string): string => `product-card:${id}`

export const productCardLockKey = (id: string): string => `lock:product-card:${id}`

export const productCardTtl = (): number => 300 + Math.floor(Math.random() * 61)

const LOCK_TTL_MS = 5000

const LOCK_POLL_MS = 25

@Injectable()
export class ProductCardService {
    constructor(
        private readonly products: ProductsRepository,
        @Inject(REDIS_CACHE) private readonly redis: Redis,
    ) {}

    async get(id: string): Promise<ProductCard | null> {
        return (await this.readCard(id)) ?? this.load(id)
    }

    private async load(id: string): Promise<ProductCard | null> {
        const lockKey = productCardLockKey(id)
        const deadline = Date.now() + LOCK_TTL_MS

        while (Date.now() < deadline) {
            const token = await acquireLock(this.redis, lockKey, LOCK_TTL_MS).catch(() => undefined)

            if (token === undefined) {
                return this.fetch(id)
            }

            if (token) {
                try {
                    return (await this.readCard(id)) ?? (await this.fetch(id))
                } finally {
                    await releaseLock(this.redis, lockKey, token).catch(() => false)
                }
            }

            await sleep(LOCK_POLL_MS)

            const card = await this.readCard(id)

            if (card) {
                return card
            }
        }

        return this.fetch(id)
    }

    private async readCard(id: string): Promise<ProductCard | null> {
        const cached = await cacheGet(this.redis, productCardKey(id))

        return cached ? (JSON.parse(cached) as ProductCard) : null
    }

    private async fetch(id: string): Promise<ProductCard | null> {
        const row = await this.products.findCard(id)

        if (!row) {
            return null
        }

        const card: ProductCard = {
            id: row.id,
            name: row.name,
            price_cents: row.price,
            stock: row.stock,
            units_sold: row.unitsSold,
        }

        await cacheSet(this.redis, productCardKey(id), JSON.stringify(card), productCardTtl())

        return card
    }
}