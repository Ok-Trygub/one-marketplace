import type { Channel } from 'amqplib'

export const EVENTS_EXCHANGE = 'shop.events'
export const DEAD_LETTER_EXCHANGE = 'shop.dlx'
export const ORDER_PLACED_QUEUE = 'shop.order-placed'
export const DEAD_LETTER_QUEUE = 'shop.dlq'
export const ORDER_PLACED_ROUTING_KEY = 'order.placed'
export const DELIVERY_LIMIT = 3

export const assertEventsExchange = (channel: Channel): Promise<unknown> => {
    return channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true })
}

export const assertTopology = async (channel: Channel): Promise<void> => {
    await assertEventsExchange(channel)
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true })

    await channel.assertQueue(DEAD_LETTER_QUEUE, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
    })
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '#')

    await channel.assertQueue(ORDER_PLACED_QUEUE, {
        durable: true,
        arguments: {
            'x-queue-type': 'quorum',
            'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
            'x-delivery-limit': DELIVERY_LIMIT,
        },
    })
    await channel.bindQueue(ORDER_PLACED_QUEUE, EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY)
}
