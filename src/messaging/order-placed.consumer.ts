import { setTimeout as sleep } from 'node:timers/promises'
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib'
import type { DataSource } from 'typeorm'
import { ORDER_PLACED_QUEUE, assertTopology } from './topology'
import type { OrderPlacedEvent } from './order-placed.event'

export const PREFETCH = 10
export const RECEIPTS_CONSUMER = 'receipts'

export type ConsumerStats = {
    delivered: number
    effect: number
    skipped: number
    alreadyApplied: number
    rejected: number
    requeued: number
    acked: number
}

export type ConsumerOptions = {
    connection: ChannelModel
    dataSource: DataSource
    ackDelayMs?: number
    onEffect?: (event: OrderPlacedEvent) => void
}

export type RunningConsumer = {
    stats: ConsumerStats
    stop: () => Promise<void>
}

export type IncomingEvent = {
    messageId: string
    event: OrderPlacedEvent
}

export type ApplyResult = 'applied' | 'duplicate' | 'already-applied'

export class PoisonMessageError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PoisonMessageError'
    }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isId = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value)

export const parseMessage = (message: ConsumeMessage): IncomingEvent => {
    const messageId: unknown = message.properties.messageId

    if (typeof messageId !== 'string' || !UUID_PATTERN.test(messageId)) {
        throw new PoisonMessageError('message has no valid messageId')
    }

    let parsed: unknown

    try {
        parsed = JSON.parse(message.content.toString())
    } catch {
        throw new PoisonMessageError('body is not valid JSON')
    }

    const event = parsed as Partial<OrderPlacedEvent>
    const data = event?.data

    if (
        event?.type !== 'order.placed' ||
        typeof event.eventId !== 'string' ||
        !isId(data?.orderId) ||
        !Number.isInteger(data?.total) ||
        (data?.total ?? -1) < 0
    ) {
        throw new PoisonMessageError('body does not match the order.placed contract')
    }

    return { messageId, event: event as OrderPlacedEvent }
}

export const applyOrderPlaced = (dataSource: DataSource, incoming: IncomingEvent): Promise<ApplyResult> => {
    const { messageId, event } = incoming

    return dataSource.transaction(async (manager) => {
        const marked = await manager.query<{ message_id: string }[]>(
            `INSERT INTO processed_messages (message_id, consumer)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING
             RETURNING message_id`,
            [messageId, RECEIPTS_CONSUMER],
        )

        if (marked.length === 0) {
            return 'duplicate'
        }

        const issued = await manager.query<{ id: string }[]>(
            `INSERT INTO receipts (event_id, order_id, total)
             VALUES ($1, $2, $3)
             ON CONFLICT (order_id) DO NOTHING
             RETURNING id`,
            [event.eventId, event.data.orderId, event.data.total],
        )

        return issued.length === 1 ? 'applied' : 'already-applied'
    })
}

export const startConsumer = async (options: ConsumerOptions): Promise<RunningConsumer> => {
    const { connection, dataSource, ackDelayMs = 0 } = options
    const stats: ConsumerStats = {
        delivered: 0,
        effect: 0,
        skipped: 0,
        alreadyApplied: 0,
        rejected: 0,
        requeued: 0,
        acked: 0,
    }
    const channel: Channel = await connection.createChannel()

    await assertTopology(channel)
    await channel.prefetch(PREFETCH)

    const handle = async (message: ConsumeMessage): Promise<void> => {
        stats.delivered += 1

        let incoming: IncomingEvent

        try {
            incoming = parseMessage(message)
        } catch {
            stats.rejected += 1
            channel.reject(message, false)

            return
        }

        try {
            const result = await applyOrderPlaced(dataSource, incoming)

            if (result === 'applied') {
                stats.effect += 1
                options.onEffect?.(incoming.event)
            } else if (result === 'duplicate') {
                stats.skipped += 1
            } else {
                stats.alreadyApplied += 1
            }
        } catch {
            stats.requeued += 1
            channel.reject(message, true)

            return
        }

        if (ackDelayMs > 0) {
            await sleep(ackDelayMs)
        }

        channel.ack(message)
        stats.acked += 1
    }

    const { consumerTag } = await channel.consume(
        ORDER_PLACED_QUEUE,
        (message) => {
            if (message) {
                void handle(message)
            }
        },
        { noAck: false },
    )

    return {
        stats,
        stop: async () => {
            await channel.cancel(consumerTag)
            await channel.close()
        },
    }
}