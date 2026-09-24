import type { DataSource } from 'typeorm'
import { User } from '../../../src/entities/user.entity'
import { Product } from '../../../src/entities/product.entity'
import type { CheckoutInput, CheckoutLine } from '../../../src/services/checkout.service'

let sequence = 0

const next = (): number => {
    sequence += 1

    return sequence
}

export type UserData = Pick<User, 'email' | 'phone' | 'name' | 'balance'>
export type ProductData = Pick<Product, 'name' | 'description' | 'price' | 'stock'>

export const aUser = (overrides: Partial<UserData> = {}): UserData => {
    const n = next()

    return {
        email: `user-${n}@example.com`,
        phone: `+38050${String(n).padStart(7, '0')}`,
        name: `User ${n}`,
        balance: 1_000_000_000,
        ...overrides,
    }
}

export const aProduct = (overrides: Partial<ProductData> = {}): ProductData => {
    const n = next()

    return {
        name: `Product ${n}`,
        description: `Description of product ${n}`,
        price: 149_900,
        stock: 10,
        ...overrides,
    }
}

export const anOrder = (
    userId: string,
    items: CheckoutLine[],
): CheckoutInput => ({ userId, items })

export const insertUser = (
    dataSource: DataSource,
    overrides: Partial<UserData> = {},
): Promise<User> => {
    const repository = dataSource.getRepository(User)

    return repository.save(repository.create(aUser(overrides)))
}

export const insertProduct = (
    dataSource: DataSource,
    overrides: Partial<ProductData> = {},
): Promise<Product> => {
    const repository = dataSource.getRepository(Product)

    return repository.save(repository.create(aProduct(overrides)))
}
