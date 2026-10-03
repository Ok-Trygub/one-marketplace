import {
    Body,
    ConflictException,
    Controller,
    Get,
    Headers,
    HttpCode,
    NotFoundException,
    Param,
    Post,
    Query,
    Res,
} from '@nestjs/common'
import type { Response } from 'express'
import { OrdersRepository } from '../repositories/orders.repository'
import { CheckoutError } from '../services/checkout.service'
import { handleIdempotency } from '../services/idempotency.service'
import type { Order } from '../entities/order.entity'

export type OrderItemResponse = {
    product_id: string
    quantity: number
    price_cents: number
}

export type OrderResponse = {
    id: string
    created_at: string
    status: string
    items: OrderItemResponse[]
    total_cents: number
}

export type CreateOrderBody = {
    user_id: string
    items: { product_id: string; quantity: number }[]
}

export const toOrderResponse = (order: Order): OrderResponse => ({
    id: order.id,
    created_at: order.createdAt.toISOString(),
    status: order.status,
    items: order.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        price_cents: item.unitPrice,
    })),
    total_cents: order.total,
})

const isId = (value: string): boolean => /^\d+$/.test(value)

const translateCheckoutError = (error: unknown): never => {
    if (error instanceof CheckoutError) {
        if (error.reason === 'PRODUCT_NOT_FOUND' || error.reason === 'USER_NOT_FOUND') {
            throw new NotFoundException(error.message)
        }

        throw new ConflictException(error.message)
    }

    throw error
}

@Controller('orders')
export class OrdersController {
    constructor(private readonly orders: OrdersRepository) {}

    @Get()
    async list(@Query('limit') limit?: string): Promise<{ items: OrderResponse[]; next_cursor: null }> {
        const orders = await this.orders.listRecent(limit ? Number(limit) : 20)

        return { items: orders.map(toOrderResponse), next_cursor: null }
    }

    @Post()
    @HttpCode(201)
    async create(
        @Headers('idempotency-key') idempotencyKey: string,
        @Body() body: CreateOrderBody,
        @Res({ passthrough: true }) response: Response,
    ): Promise<OrderResponse> {
        if (!isId(body.user_id)) {
            throw new NotFoundException(`Buyer '${body.user_id}' was not found`)
        }

        const unknownProduct = body.items.find((item) => !isId(item.product_id))

        if (unknownProduct) {
            throw new NotFoundException(`Product '${unknownProduct.product_id}' was not found`)
        }

        const result = await handleIdempotency(idempotencyKey, body, () =>
            this.orders
                .create({
                    userId: body.user_id,
                    items: body.items.map((item) => ({
                        productId: item.product_id,
                        quantity: item.quantity,
                    })),
                })
                .then(toOrderResponse, translateCheckoutError),
        )

        if (result.replay) {
            response.set('Idempotency-Replay', 'true')
        }

        return result.response
    }

    @Get(':id')
    async getById(@Param('id') id: string): Promise<OrderResponse> {
        const order = isId(id) ? await this.orders.findById(id) : null

        if (!order) {
            throw new NotFoundException(`Order '${id}' was not found`)
        }

        return toOrderResponse(order)
    }
}
