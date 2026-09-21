import type { DataSource } from 'typeorm'
import { Order } from '../entities/order.entity'
import { OrderItem } from '../entities/order-item.entity'
import { Job } from '../entities/job.entity'

export type CheckoutInput = {
    userId: string
    productId: string
    quantity: number
}

export type CheckoutResult = {
    orderId: string
    total: number
}

export type CheckoutFailure =
    | 'PRODUCT_NOT_FOUND'
    | 'OUT_OF_STOCK'
    | 'USER_NOT_FOUND'
    | 'INSUFFICIENT_FUNDS'

export class CheckoutError extends Error {
    readonly reason: CheckoutFailure

    constructor(reason: CheckoutFailure) {
        super(reason)
        this.name = 'CheckoutError'
        this.reason = reason
    }
}

type UpdateReturning<Row> = [Row[], number]

export const checkout = async (
    dataSource: DataSource,
    input: CheckoutInput,
): Promise<CheckoutResult> => {
    const { userId, productId, quantity } = input

    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('quantity must be a positive integer')
    }

    return dataSource.transaction(async (manager) => {
        const [products] = await manager.query<UpdateReturning<{ price: number }>>(
            `UPDATE products
             SET stock = stock - $1
             WHERE id = $2 AND stock >= $1
             RETURNING price`,
            [quantity, productId],
        )

        const product = products[0]

        if (!product) {
            const found = await manager.query<unknown[]>(
                'SELECT 1 FROM products WHERE id = $1',
                [productId],
            )

            throw new CheckoutError(found.length > 0 ? 'OUT_OF_STOCK' : 'PRODUCT_NOT_FOUND')
        }

        const total = product.price * quantity

        const [users] = await manager.query<UpdateReturning<{ balance: number }>>(
            `UPDATE users
             SET balance = balance - $1
             WHERE id = $2 AND balance >= $1
             RETURNING balance`,
            [total, userId],
        )

        if (!users[0]) {
            const found = await manager.query<unknown[]>(
                'SELECT 1 FROM users WHERE id = $1',
                [userId],
            )

            throw new CheckoutError(found.length > 0 ? 'INSUFFICIENT_FUNDS' : 'USER_NOT_FOUND')
        }

        const order = await manager.save(
            manager.create(Order, { userId, status: 'paid', total }),
        )

        await manager.save(
            manager.create(OrderItem, {
                orderId: order.id,
                productId,
                quantity,
                unitPrice: product.price,
            }),
        )

        await manager.save(
            manager.create(Job, {
                type: 'send_receipt',
                payload: { orderId: order.id },
            }),
        )

        return { orderId: order.id, total }
    })
}
