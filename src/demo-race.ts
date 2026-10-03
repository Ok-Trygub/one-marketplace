import 'reflect-metadata'
import { DataSource, In } from 'typeorm'
import { dataSourceOptions } from './data-source'
import { Product } from './entities/product.entity'
import { User } from './entities/user.entity'
import { Order } from './entities/order.entity'
import { Job } from './entities/job.entity'
import { checkout, CheckoutError } from './services/checkout.service'
import type { CheckoutFailure } from './services/checkout.service'

const ATTEMPTS = 50
const INITIAL_STOCK = 10
const BUYER_BALANCE = 1_000_000_000
const PRODUCT_NAME = 'Електрочайник Tefal TF-1008'

type Outcome = 'SUCCESS' | CheckoutFailure

const dataSource = new DataSource({
    ...dataSourceOptions,
    poolSize: ATTEMPTS,
})

const buyers = Array.from({ length: ATTEMPTS }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')

    return {
        email: `race-buyer-${number}@example.com`,
        phone: `+38099${String(index + 1).padStart(7, '0')}`,
        name: `Race Buyer ${number}`,
        balance: BUYER_BALANCE,
    }
})

const attempt = async (userId: string, productId: string): Promise<Outcome> => {
    try {
        await checkout(dataSource, { userId, items: [{ productId, quantity: 1 }] })

        return 'SUCCESS'
    } catch (error) {
        if (error instanceof CheckoutError) {
            return error.reason
        }

        throw error
    }
}

const main = async () => {
    await dataSource.initialize()

    try {
        const productRepository = dataSource.getRepository(Product)
        const userRepository = dataSource.getRepository(User)
        const orderRepository = dataSource.getRepository(Order)
        const jobRepository = dataSource.getRepository(Job)

        const emails = buyers.map((buyer) => buyer.email)

        await userRepository
            .createQueryBuilder()
            .insert()
            .values(buyers)
            .orIgnore()
            .execute()

        await userRepository.update({ email: In(emails) }, { balance: BUYER_BALANCE })

        const product = await productRepository.findOneByOrFail({ name: PRODUCT_NAME })

        await productRepository.update({ id: product.id }, { stock: INITIAL_STOCK })

        const users = await userRepository.find({
            where: { email: In(emails) },
            order: { id: 'ASC' },
        })

        const ordersBefore = await orderRepository.count()
        const jobsBefore = await jobRepository.count()

        const outcomes = await Promise.all(
            users.map((user) => attempt(user.id, product.id)),
        )

        const succeeded = outcomes.filter((outcome) => outcome === 'SUCCESS').length
        const outOfStock = outcomes.filter((outcome) => outcome === 'OUT_OF_STOCK').length
        const insufficientFunds = outcomes.filter((outcome) => outcome === 'INSUFFICIENT_FUNDS').length

        const { stock: finalStock } = await productRepository.findOneByOrFail({ id: product.id })

        const [{ count: negativeRows }] = await dataSource.query<{ count: number }[]>(
            'SELECT count(*)::int AS count FROM products WHERE stock < 0',
        )

        const ordersCreated = (await orderRepository.count()) - ordersBefore
        const jobsCreated = (await jobRepository.count()) - jobsBefore

        console.log(`attempts: ${outcomes.length}`)
        console.log(`succeeded: ${succeeded}`)
        console.log(`rejected, out of stock: ${outOfStock}`)
        console.log(`rejected, insufficient funds: ${insufficientFunds}`)
        console.log(`final stock: ${finalStock}`)
        console.log(`rows with negative stock: ${negativeRows}`)
        console.log(`orders created: ${ordersCreated}`)
        console.log(`jobs created: ${jobsCreated}`)

        const invariantHolds =
            outcomes.length === ATTEMPTS &&
            succeeded === INITIAL_STOCK &&
            finalStock === 0 &&
            negativeRows === 0 &&
            ordersCreated === succeeded &&
            jobsCreated === succeeded

        if (!invariantHolds) {
            console.error('INVARIANT VIOLATED: oversell or orphan orders')
            process.exitCode = 1

            return
        }

        console.log('invariant holds: no oversell')
    } finally {
        await dataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})