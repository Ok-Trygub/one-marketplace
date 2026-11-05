import {
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    Headers,
    HttpCode,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    Res,
    UnprocessableEntityException,
    UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { concatMap, takeWhile } from 'rxjs'
import { AccessAuthenticator } from '../auth/access-authenticator'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import { CurrentUser } from '../auth/current-user.decorator'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { OrdersRepository } from '../repositories/orders.repository'
import { CheckoutError } from '../services/checkout.service'
import { OrderEventsService } from '../services/order-events.service'
import type { OrderStatusEvent } from '../services/order-events.service'
import { OrderStatusError, OrderStatusService } from '../services/order-status.service'
import { IdempotencyKeyReusedError, PlaceOrderService } from '../services/place-order.service'
import type { PlacedOrder } from '../services/place-order.service'
import type { OrderStatus } from '../services/order-status.service'
import type { Order } from '../entities/order.entity'

export type OrderItemResponse = {
    product_id: string
    quantity: number
    price_cents: number
}

export type OrderResponse = {
    id: string
    user_id: string
    created_at: string
    status: string
    items: OrderItemResponse[]
    total_cents: number
}

export type CreateOrderBody = {
    items: { product_id: string; quantity: number }[]
}

export type ChangeOrderStatusBody = {
    status: OrderStatus
}

export const toOrderResponse = (order: Order): OrderResponse => ({
    id: order.id,
    user_id: order.userId,
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

const translatePlaceOrderError = (error: unknown): never => {
    if (error instanceof IdempotencyKeyReusedError) {
        throw new UnprocessableEntityException(error.message)
    }

    if (error instanceof CheckoutError) {
        if (error.reason === 'PRODUCT_NOT_FOUND' || error.reason === 'USER_NOT_FOUND') {
            throw new NotFoundException(error.message)
        }

        throw new ConflictException(error.message)
    }

    throw error
}

const toLastEventId = (value: string | undefined): number | null => {
    return value !== undefined && /^\d+$/.test(value) ? Number(value) : null
}

const toSseBlock = (event: OrderStatusEvent): string => {
    return `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`
}

const translateOrderStatusError = (error: unknown): never => {
    if (error instanceof OrderStatusError) {
        if (error.reason === 'ORDER_NOT_FOUND') {
            throw new NotFoundException(error.message)
        }

        throw new ConflictException(error.message)
    }

    throw error
}

@Controller('orders')
@UseGuards(AuthGuard, RolesGuard)
export class OrdersController {
    constructor(
        private readonly orders: OrdersRepository,
        private readonly orderStatus: OrderStatusService,
        private readonly events: OrderEventsService,
        private readonly placeOrder: PlaceOrderService,
        private readonly authenticator: AccessAuthenticator,
    ) {}

    @Get()
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Query('limit') limit?: string,
    ): Promise<{ items: OrderResponse[]; next_cursor: null }> {
        const orders = await this.orders.listByUser(user.id, limit ? Number(limit) : 20)

        return { items: orders.map(toOrderResponse), next_cursor: null }
    }

    @Post()
    @HttpCode(201)
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Headers('idempotency-key') idempotencyKey: string,
        @Body() body: CreateOrderBody,
        @Res({ passthrough: true }) response: Response,
    ): Promise<OrderResponse> {
        const unknownProduct = body.items.find((item) => !isId(item.product_id))

        if (unknownProduct) {
            throw new NotFoundException(`Product '${unknownProduct.product_id}' was not found`)
        }

        const placed: PlacedOrder = await this.placeOrder
            .place({
                userId: user.id,
                items: body.items.map((item) => ({
                    productId: item.product_id,
                    quantity: item.quantity,
                })),
                idempotencyKey,
            })
            .catch(translatePlaceOrderError)

        if (placed.replay) {
            response.set('Idempotency-Replay', 'true')
        }

        return toOrderResponse(placed.order)
    }

    @Get(':id')
    async getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OrderResponse> {
        const order = await this.load(id)

        if (order.userId !== user.id) {
            throw new ForbiddenException(`Order '${id}' belongs to another buyer`)
        }

        return toOrderResponse(order)
    }

    @Patch(':id/status')
    @Roles('seller', 'admin')
    async changeStatus(
        @Param('id') id: string,
        @Body() body: ChangeOrderStatusBody,
    ): Promise<OrderResponse> {
        if (!isId(id)) {
            throw new NotFoundException(`Order '${id}' was not found`)
        }

        await this.orderStatus.change(id, body.status).catch(translateOrderStatusError)

        return toOrderResponse(await this.load(id))
    }

    @Get(':id/events')
    async streamEvents(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') id: string,
        @Headers('last-event-id') lastEventId: string | undefined,
        @Res() response: Response,
    ): Promise<void> {
        const ownerId = isId(id) ? await this.orders.findOwnerId(id) : null

        if (!ownerId) {
            throw new NotFoundException(`Order '${id}' was not found`)
        }

        if (ownerId !== user.id) {
            throw new ForbiddenException(`Order '${id}' belongs to another buyer`)
        }

        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        })
        response.write('retry: 1000\n\n')

        const lastSeen = toLastEventId(lastEventId)

        if (lastSeen !== null) {
            for (const missed of this.events.missedSince(id, lastSeen)) {
                response.write(toSseBlock(missed))
            }
        }

        const subscription = this.events
            .streamFor(id)
            .pipe(
                concatMap(async (event) => ({ event, allowed: await this.authenticator.isStillValid(user) })),
                takeWhile(({ allowed }) => allowed),
            )
            .subscribe({
                next: ({ event }) => response.write(toSseBlock(event)),
                complete: () => response.end(),
            })
        const expiry = setTimeout(() => response.end(), Math.max(0, user.expiresAt * 1000 - Date.now()))

        response.on('close', () => {
            clearTimeout(expiry)
            subscription.unsubscribe()
        })
    }

    private async load(id: string): Promise<Order> {
        const order = isId(id) ? await this.orders.findById(id) : null

        if (!order) {
            throw new NotFoundException(`Order '${id}' was not found`)
        }

        return order
    }
}
