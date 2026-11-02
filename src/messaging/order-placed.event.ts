export const ORDER_AGGREGATE_TYPE = 'Order'
export const ORDER_PLACED_TYPE = 'order.placed'

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

export type OrderPlacedSource = {
    id: string
    userId: string
    total: number
    createdAt: Date
    items: { productId: string; quantity: number; unitPrice: number }[]
}

export const orderPlacedEventId = (orderId: string): string => `order.placed:${orderId}`

export const toOrderPlacedEvent = (order: OrderPlacedSource): OrderPlacedEvent => ({
    eventId: orderPlacedEventId(order.id),
    type: ORDER_PLACED_TYPE,
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