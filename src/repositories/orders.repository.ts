import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Order } from '../entities/order.entity'
import { checkout } from '../services/checkout.service'
import type { CheckoutInput } from '../services/checkout.service'

export type OrderStatusCount = {
    status: string
    count: string
}

@Injectable()
export class OrdersRepository {
    constructor(private readonly dataSource: DataSource) {}

    async create(input: CheckoutInput): Promise<Order> {
        const { orderId } = await checkout(this.dataSource, input)
        const order = await this.findById(orderId)

        if (!order) {
            throw new Error(`order ${orderId} disappeared right after checkout`)
        }

        return order
    }

    findById(id: string): Promise<Order | null> {
        return this.dataSource.getRepository(Order).findOne({
            where: { id },
            relations: { items: { product: true } },
            order: { items: { id: 'ASC' } },
        })
    }

    listByUser(userId: string): Promise<Order[]> {
        return this.dataSource.getRepository(Order).find({
            where: { userId },
            relations: { items: true },
            order: { createdAt: 'DESC' },
        })
    }

    listRecent(limit: number): Promise<Order[]> {
        return this.dataSource.getRepository(Order).find({
            relations: { items: true },
            order: { id: 'DESC' },
            take: limit,
        })
    }

    countByStatus(): Promise<OrderStatusCount[]> {
        return this.dataSource
            .getRepository(Order)
            .createQueryBuilder('o')
            .select('o.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('o.status')
            .orderBy('o.status', 'ASC')
            .getRawMany<OrderStatusCount>()
    }
}
