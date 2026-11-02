import 'reflect-metadata'
import { In, Like } from 'typeorm'
import { AppDataSource } from './data-source'
import { Product } from './entities/product.entity'
import { connectCache } from './redis/redis'
import { ProductsRepository } from './repositories/products.repository'
import { ProductCardService, productCardKey } from './services/product-card.service'
import { printSummary } from './messaging/demo-support'

const PRODUCT_COUNT = 50
const CONCURRENT = 50
const WARM_READS = 100
const NAME_PREFIX = 'Demo cache product'

const demoProducts = Array.from({ length: PRODUCT_COUNT }, (_, index) => ({
    name: `${NAME_PREFIX} ${String(index + 1).padStart(2, '0')}`,
    description: 'Created by demo:cache, removed at the end of the run',
    price: 100 + index,
    stock: 10,
}))

const main = async (): Promise<number> => {
    await AppDataSource.initialize()

    const cache = connectCache()
    const productsTable = AppDataSource.getRepository(Product)
    let keys: string[] = []

    try {
        const [, policy] = (await cache.config('GET', 'maxmemory-policy')) as string[]
        const [, maxmemory] = (await cache.config('GET', 'maxmemory')) as string[]

        await productsTable.upsert(demoProducts, ['name'])

        const products = await productsTable.find({
            where: { name: In(demoProducts.map((product) => product.name)) },
            order: { id: 'ASC' },
        })

        keys = products.map((product) => productCardKey(product.id))
        await cache.del(...keys)

        const repository = new ProductsRepository(AppDataSource)
        const service = new ProductCardService(repository, cache)

        for (const product of products) {
            await service.get(product.id)
        }

        const ttls = await Promise.all(keys.map((key) => cache.ttl(key)))
        const warmedTtls = ttls.filter((ttl) => ttl > 0)

        const target = products[0].id

        await cache.del(productCardKey(target))

        const beforeStampede = repository.cardQueries

        await Promise.all(Array.from({ length: CONCURRENT }, () => service.get(target)))

        const dbCalls = repository.cardQueries - beforeStampede
        const beforeWarm = repository.cardQueries

        for (let read = 0; read < WARM_READS; read += 1) {
            await service.get(target)
        }

        const dbCallsWarm = repository.cardQueries - beforeWarm

        const summary = {
            'cache-lru': policy !== 'noeviction' ? 1 : 0,
            'cache-maxmemory': Number(maxmemory) > 0 ? 1 : 0,
            warmed: warmedTtls.length,
            'ttl-distinct': new Set(warmedTtls).size,
            concurrent: CONCURRENT,
            'db-calls': dbCalls,
            'db-calls-warm': dbCallsWarm,
        }

        printSummary(summary)

        const ok =
            summary['cache-lru'] === 1 &&
            summary['cache-maxmemory'] === 1 &&
            summary.warmed >= PRODUCT_COUNT &&
            summary['ttl-distinct'] >= 5 &&
            summary['db-calls'] === 1 &&
            summary['db-calls-warm'] === 0

        return ok ? 0 : 1
    } finally {
        if (keys.length > 0) {
            await cache.del(...keys)
        }

        await productsTable.delete({ name: Like(`${NAME_PREFIX} %`) })
        await cache.quit()
        await AppDataSource.destroy()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })