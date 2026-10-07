import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Order } from '../entities/order.entity'
import { OrderEventsService } from './order-events.service'
import type { OrderStatusEvent } from './order-events.service'

export type OrderStatus = 'pending' | 'paid' | 'cancelled'

export type OrderStatusFailure = 'ORDER_NOT_FOUND' | 'INVALID_TRANSITION'

export class OrderStatusError extends Error {
    readonly reason: OrderStatusFailure

    constructor(reason: OrderStatusFailure, message: string) {
        super(message)
        this.name = 'OrderStatusError'
        this.reason = reason
    }
}

const ALLOWED_PREVIOUS: Record<OrderStatus, OrderStatus[]> = {
    pending: ['paid'],
    paid: ['pending'],
    cancelled: ['pending', 'paid'],
}

@Injectable()
export class OrderStatusService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly events: OrderEventsService,
    ) {}

    async change(orderId: string, status: OrderStatus): Promise<OrderStatusEvent> {
        const result = await this.dataSource
            .createQueryBuilder()
            .update(Order)
            .set({ status })
            .where('id = :orderId', { orderId })
            .andWhere('status IN (:...previous)', { previous: ALLOWED_PREVIOUS[status] })
            .execute()

        if (result.affected === 1) {
            return this.events.publish(orderId, status)
        }

        const order = await this.dataSource.getRepository(Order).findOne({
            where: { id: orderId },
            select: { id: true, status: true },
        })

        if (!order) {
            throw new OrderStatusError('ORDER_NOT_FOUND', `Order '${orderId}' was not found`)
        }

        throw new OrderStatusError(
            'INVALID_TRANSITION',
            `Order '${orderId}' cannot change status from '${order.status}' to '${status}'`,
        )
    }
}
