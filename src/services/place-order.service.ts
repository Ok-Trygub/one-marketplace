import { Injectable, Logger } from '@nestjs/common'
import { OrdersRepository } from '../repositories/orders.repository'
import { OrderPlacedPublisher } from '../messaging/order-placed.publisher'
import { orderPlacedEvent } from '../messaging/order-placed.event'
import type { CheckoutInput } from './checkout.service'
import type { Order } from '../entities/order.entity'

@Injectable()
export class PlaceOrderService {
    private readonly logger = new Logger(PlaceOrderService.name)

    constructor(
        private readonly orders: OrdersRepository,
        private readonly publisher: OrderPlacedPublisher,
    ) {}

    async place(input: CheckoutInput): Promise<Order> {
        const order = await this.orders.create(input)
        const event = orderPlacedEvent(order)

        try {
            await this.publisher.publish(event)
        } catch (error) {
            this.logger.error(`order ${order.id} is committed but ${event.eventId} was not published`, error)
        }

        return order
    }
}
