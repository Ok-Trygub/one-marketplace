import { findProductById } from './products.service'

type CreateOrderItem = {
    product_id: string
    quantity: number
}

type CreateOrder = {
    items: CreateOrderItem[]
}

type OrderItem = CreateOrderItem & {
    price_cents: number
}

export type Order = {
    id: string
    created_at: string
    status: 'pending' | 'paid' | 'cancelled'
    items: OrderItem[]
    total_cents: number
}

const orders: Order[] = []

export const createOrder = (data: CreateOrder): Order => {
    const items = data.items.map((item) => {
        const product = findProductById(item.product_id)

        if (!product) {
            const error = new Error(
                `Product '${item.product_id}' was not found`,
            ) as Error & { status: number }

            error.status = 404

            throw error
        }

        return {
            product_id: product.id,
            quantity: item.quantity,
            price_cents: product.price_cents,
        }
    })

    const total_cents = items.reduce(
        (total, item) => total + item.price_cents * item.quantity,
        0,
    )

    const order: Order = {
        id: `order-${orders.length + 1}`,
        created_at: new Date().toISOString(),
        status: 'pending',
        items,
        total_cents,
    }

    orders.push(order)

    return order
}

export const findOrders = (): Order[] => {
    return orders
}

export const findOrderById = (id: string): Order | undefined => {
    return orders.find((order) => order.id === id)
}