import { Inject, Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { OrdersRepository } from '../repositories/orders.repository'
import { PRODUCT_CARDS_QUEUE_TOKEN, enqueueRefresh } from './product-cards.queue'
import type { RefreshJobData } from './product-cards.queue'

@Injectable()
export class ProductCardRefresher {
    constructor(
        @Inject(PRODUCT_CARDS_QUEUE_TOKEN) private readonly queue: Queue<RefreshJobData>,
        private readonly orders: OrdersRepository,
    ) {}

    async refreshProducts(productIds: string[], eventKey: string): Promise<void> {
        try {
            await Promise.all(
                [...new Set(productIds)].map((productId) => enqueueRefresh(this.queue, productId, eventKey)),
            )
        } catch (error) {
            console.warn(
                `product card refresh was not queued for ${eventKey}: ${error instanceof Error ? error.message : error}`,
            )
        }
    }

    async refreshOrder(orderId: string, eventKey: string): Promise<void> {
        const order = await this.orders.findById(orderId)

        if (order) {
            await this.refreshProducts(
                order.items.map((item) => item.productId),
                eventKey,
            )
        }
    }
}
