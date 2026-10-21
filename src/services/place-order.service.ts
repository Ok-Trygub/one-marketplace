import { Injectable } from '@nestjs/common'
import { QueryFailedError } from 'typeorm'
import { OrdersRepository } from '../repositories/orders.repository'
import type { CheckoutInput, CheckoutLine } from './checkout.service'
import type { Order } from '../entities/order.entity'

const IDEMPOTENCY_INDEX = 'orders_user_id_idempotency_key_key'

export type PlacedOrder = {
    order: Order
    replay: boolean
}

export class IdempotencyKeyReusedError extends Error {
    constructor(idempotencyKey: string) {
        super(`Idempotency-Key '${idempotencyKey}' was already used with a different request body`)
        this.name = 'IdempotencyKeyReusedError'
    }
}

const isIdempotencyConflict = (error: unknown): boolean => {
    if (!(error instanceof QueryFailedError)) {
        return false
    }

    const driverError = error.driverError as { code?: string; constraint?: string }

    return driverError.code === '23505' && driverError.constraint === IDEMPOTENCY_INDEX
}

const normalizeLines = (lines: CheckoutLine[]): string => {
    return lines
        .map((line) => `${line.productId}:${line.quantity}`)
        .sort()
        .join(',')
}

const isSameRequest = (order: Order, input: CheckoutInput): boolean => {
    return normalizeLines(order.items) === normalizeLines(input.items)
}

@Injectable()
export class PlaceOrderService {
    constructor(private readonly orders: OrdersRepository) {}

    async place(input: CheckoutInput): Promise<PlacedOrder> {
        const existing = await this.findExisting(input)

        if (existing) {
            return existing
        }

        try {
            return { order: await this.orders.create(input), replay: false }
        } catch (error) {
            if (!isIdempotencyConflict(error)) {
                throw error
            }

            const winner = await this.findExisting(input)

            if (!winner) {
                throw error
            }

            return winner
        }
    }

    private async findExisting(input: CheckoutInput): Promise<PlacedOrder | null> {
        if (!input.idempotencyKey) {
            return null
        }

        const order = await this.orders.findByIdempotencyKey(input.userId, input.idempotencyKey)

        if (!order) {
            return null
        }

        if (!isSameRequest(order, input)) {
            throw new IdempotencyKeyReusedError(input.idempotencyKey)
        }

        return { order, replay: true }
    }
}