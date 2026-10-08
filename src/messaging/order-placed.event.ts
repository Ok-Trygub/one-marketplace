import type { Order } from '../entities/order.entity'

export type OrderPlacedEvent = {
    eventId: string
    type: 'order.placed'
    occurredAt: string
    data: {
        orderId: string
        userId: string
        total: number
        items: { productId: string; quantity: number; unitPrice: number }[]
    }
}

export const orderPlacedEventId = (orderId: string): string => `order.placed:${orderId}`

export const orderPlacedEvent = (order: Order): OrderPlacedEvent => ({
    eventId: orderPlacedEventId(order.id),
    type: 'order.placed',
    occurredAt: order.createdAt.toISOString(),
    data: {
        orderId: order.id,
        userId: order.userId,
        total: order.total,
        items: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
        })),
    },
})
