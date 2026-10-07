import { Injectable } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { Observable, Subject, filter } from 'rxjs'

export type OrderStatusEvent = {
    id: number
    orderId: string
    status: string
    changedAt: string
}

const BUFFER_SIZE = 100
const MAX_ORDERS = 1000

@Injectable()
export class OrderEventsService implements OnModuleDestroy {
    private readonly subject = new Subject<OrderStatusEvent>()
    private readonly buffers = new Map<string, OrderStatusEvent[]>()

    onModuleDestroy(): void {
        this.subject.complete()
    }

    publish(orderId: string, status: string): OrderStatusEvent {
        const buffer = this.buffers.get(orderId) ?? []
        const event: OrderStatusEvent = {
            id: (buffer.at(-1)?.id ?? 0) + 1,
            orderId,
            status,
            changedAt: new Date().toISOString(),
        }

        buffer.push(event)

        if (buffer.length > BUFFER_SIZE) {
            buffer.shift()
        }

        this.buffers.delete(orderId)
        this.buffers.set(orderId, buffer)

        if (this.buffers.size > MAX_ORDERS) {
            const oldest = this.buffers.keys().next().value

            if (oldest !== undefined) {
                this.buffers.delete(oldest)
            }
        }

        this.subject.next(event)

        return event
    }

    stream(): Observable<OrderStatusEvent> {
        return this.subject.asObservable()
    }

    streamFor(orderId: string): Observable<OrderStatusEvent> {
        return this.subject.pipe(filter((event) => event.orderId === orderId))
    }

    missedSince(orderId: string, lastEventId: number): OrderStatusEvent[] {
        const buffer = this.buffers.get(orderId) ?? []

        return buffer.filter((event) => event.id > lastEventId)
    }
}
