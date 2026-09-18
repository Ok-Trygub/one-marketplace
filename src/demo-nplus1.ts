import 'reflect-metadata'
import { DataSource, In } from 'typeorm'
import type { Logger } from 'typeorm'
import { AppDataSource } from './data-source'
import { Order } from './entities/order.entity'
import { OrderItem } from './entities/order-item.entity'
import { Product } from './entities/product.entity'

class QueryCountLogger implements Logger {
    count = 0

    logQuery(query: string, parameters?: unknown[]) {
        this.count += 1

        const suffix = parameters && parameters.length > 0
            ? ` -- ${JSON.stringify(parameters)}`
            : ''

        console.log(`  #${this.count} ${query}${suffix}`)
    }

    logQueryError() {}

    logQuerySlow() {}

    logSchemaBuild() {}

    logMigration() {}

    log() {}
}

const logger = new QueryCountLogger()

const dataSource = new DataSource({
    ...AppDataSource.options,
    logging: ['query'],
    logger,
})

const measure = async (
    label: string,
    work: () => Promise<unknown>,
): Promise<number> => {
    console.log(`\n${label}`)
    logger.count = 0

    await work()

    return logger.count
}

const main = async () => {
    await dataSource.initialize()

    try {
        const orderRepository = dataSource.getRepository(Order)
        const orderItemRepository = dataSource.getRepository(OrderItem)
        const productRepository = dataSource.getRepository(Product)

        const naive = async (ids: string[]) => {
            const orders = await orderRepository.find({
                where: { id: In(ids) },
                order: { id: 'ASC' },
            })

            for (const order of orders) {
                const items = await orderItemRepository.find({
                    where: { orderId: order.id },
                })

                for (const item of items) {
                    await productRepository.findOneBy({ id: item.productId })
                }
            }
        }

        const withJoin = (ids: string[]) =>
            orderRepository.find({
                where: { id: In(ids) },
                order: { id: 'ASC' },
                relations: { items: { product: true } },
            })

        const withQueryStrategy = (ids: string[]) =>
            orderRepository.find({
                where: { id: In(ids) },
                order: { id: 'ASC' },
                relations: { items: { product: true } },
                relationLoadStrategy: 'query',
            })

        console.log('Preparing: order ids')

        const allIds = (
            await orderRepository.find({
                select: { id: true },
                order: { id: 'ASC' },
            })
        ).map((order) => order.id)

        const results = []

        for (const size of [3, 7]) {
            const ids = allIds.slice(0, size)

            results.push({
                N: size,
                'naive (query per item)': await measure(`N = ${size}: naive`, () => naive(ids)),
                'relations (join)': await measure(`N = ${size}: relations, join`, () => withJoin(ids)),
                "relationLoadStrategy 'query'": await measure(`N = ${size}: relationLoadStrategy query`, () => withQueryStrategy(ids)),
            })
        }

        console.log('')
        console.table(results)
    } finally {
        await dataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})