import { setTimeout as sleep } from 'node:timers/promises'
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib'
import type { DataSource } from 'typeorm'
import { Receipt } from '../entities/receipt.entity'
import { ORDER_PLACED_QUEUE, assertTopology } from './topology'
import type { OrderPlacedEvent } from './order-placed.event'

export const PREFETCH = 10

export type ConsumerStats = {
    delivered: number
    effect: number
    skipped: number
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

export class PoisonMessageError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PoisonMessageError'
    }
}

const isId = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value)

export const parseEvent = (message: ConsumeMessage): OrderPlacedEvent => {
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

    return event as OrderPlacedEvent
}

export const issueReceipt = async (dataSource: DataSource, event: OrderPlacedEvent): Promise<boolean> => {
    const result = await dataSource
        .createQueryBuilder()
        .insert()
        .into(Receipt)
        .values({
            eventId: event.eventId,
            orderId: event.data.orderId,
            total: event.data.total,
        })
        .orIgnore()
        .returning(['id'])
        .execute()

    return result.raw.length === 1
}

export const startConsumer = async (options: ConsumerOptions): Promise<RunningConsumer> => {
    const { connection, dataSource, ackDelayMs = 0 } = options
    const stats: ConsumerStats = { delivered: 0, effect: 0, skipped: 0, rejected: 0, requeued: 0, acked: 0 }
    const channel: Channel = await connection.createChannel()

    await assertTopology(channel)
    await channel.prefetch(PREFETCH)

    const handle = async (message: ConsumeMessage): Promise<void> => {
        stats.delivered += 1

        let event: OrderPlacedEvent

        try {
            event = parseEvent(message)
        } catch {
            stats.rejected += 1
            channel.reject(message, false)

            return
        }

        try {
            const applied = await issueReceipt(dataSource, event)

            if (applied) {
                stats.effect += 1
                options.onEffect?.(event)
            } else {
                stats.skipped += 1
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
