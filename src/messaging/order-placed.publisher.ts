import { Inject, Injectable } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'
import type { ChannelModel, ConfirmChannel } from 'amqplib'
import { BROKER_CONNECTION } from './broker'
import { EVENTS_EXCHANGE, ORDER_PLACED_ROUTING_KEY, assertEventsExchange } from './topology'
import type { OrderPlacedEvent } from './order-placed.event'

export class UnroutableEventError extends Error {
    constructor(eventId: string) {
        super(`event ${eventId} was returned by the broker: no queue is bound to ${ORDER_PLACED_ROUTING_KEY}`)
        this.name = 'UnroutableEventError'
    }
}

@Injectable()
export class OrderPlacedPublisher implements OnModuleInit {
    private channel: ConfirmChannel | null = null
    private readonly returned = new Set<string>()

    constructor(@Inject(BROKER_CONNECTION) private readonly connection: ChannelModel) {}

    onModuleInit(): Promise<void> {
        return this.open()
    }

    async open(): Promise<void> {
        const channel = await this.connection.createConfirmChannel()

        await assertEventsExchange(channel)

        channel.on('return', (message) => {
            this.returned.add(String(message.properties.messageId))
        })

        this.channel = channel
    }

    async publish(event: OrderPlacedEvent): Promise<void> {
        if (!this.channel) {
            throw new Error('publisher channel is not open')
        }

        this.channel.publish(
            EVENTS_EXCHANGE,
            ORDER_PLACED_ROUTING_KEY,
            Buffer.from(JSON.stringify(event)),
            {
                persistent: true,
                mandatory: true,
                contentType: 'application/json',
                messageId: event.eventId,
                type: event.type,
                timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
            },
        )

        await this.channel.waitForConfirms()

        if (this.returned.delete(event.eventId)) {
            throw new UnroutableEventError(event.eventId)
        }
    }
}
