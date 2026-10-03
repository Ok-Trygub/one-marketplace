import type { DataSource } from 'typeorm'
import { Order } from '../entities/order.entity'
import { OrderItem } from '../entities/order-item.entity'
import { Job } from '../entities/job.entity'

export type CheckoutLine = {
    productId: string
    quantity: number
}

export type CheckoutInput = {
    userId: string
    items: CheckoutLine[]
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
    readonly productId?: string

    constructor(reason: CheckoutFailure, productId?: string) {
        super(productId ? `${reason}: product ${productId}` : reason)
        this.name = 'CheckoutError'
        this.reason = reason
        this.productId = productId
    }
}

type UpdateReturning<Row> = [Row[], number]

const validateLines = (items: CheckoutLine[]): CheckoutLine[] => {
    if (items.length === 0) {
        throw new Error('items must not be empty')
    }

    for (const item of items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new Error('quantity must be a positive integer')
        }
    }

    return [...items].sort((a, b) => Number(a.productId) - Number(b.productId))
}

export const checkout = async (
    dataSource: DataSource,
    input: CheckoutInput,
): Promise<CheckoutResult> => {
    const { userId } = input
    const lines = validateLines(input.items)

    return dataSource.transaction(async (manager) => {
        const priced: { productId: string; quantity: number; unitPrice: number }[] = []

        for (const line of lines) {
            const [rows] = await manager.query<UpdateReturning<{ price: number }>>(
                `UPDATE products
                 SET stock = stock - $1
                 WHERE id = $2 AND stock >= $1
                 RETURNING price`,
                [line.quantity, line.productId],
            )

            const product = rows[0]

            if (!product) {
                const found = await manager.query<unknown[]>(
                    'SELECT 1 FROM products WHERE id = $1',
                    [line.productId],
                )

                throw new CheckoutError(
                    found.length > 0 ? 'OUT_OF_STOCK' : 'PRODUCT_NOT_FOUND',
                    line.productId,
                )
            }

            priced.push({ ...line, unitPrice: product.price })
        }

        const total = priced.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)

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

        await manager.insert(
            OrderItem,
            priced.map((line) => ({
                orderId: order.id,
                productId: line.productId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
            })),
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
