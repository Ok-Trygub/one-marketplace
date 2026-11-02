import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets'
import type { OnGatewayInit } from '@nestjs/websockets'
import type { OnModuleDestroy } from '@nestjs/common'
import type { Subscription } from 'rxjs'
import type { Server, Socket } from 'socket.io'
import { AccessAuthenticator, AccessTokenRejectedError, RevocationCheckUnavailableError } from '../auth/access-authenticator'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import { OrdersRepository } from '../repositories/orders.repository'
import { OrderEventsService } from '../services/order-events.service'

export type JoinFailure = 'UNAUTHORIZED' | 'UNAVAILABLE' | 'ORDER_NOT_FOUND' | 'FORBIDDEN'

export type JoinAck = { ok: true; room: string } | { ok: false; error: JoinFailure }

export const orderRoom = (orderId: string): string => `orders:${orderId}`

const toId = (value: unknown): string | null => {
    const id = typeof value === 'number' ? String(value) : value

    return typeof id === 'string' && /^\d+$/.test(id) ? id : null
}

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
    @WebSocketServer()
    private readonly server!: Server

    private subscription?: Subscription

    constructor(
        private readonly orders: OrdersRepository,
        private readonly events: OrderEventsService,
        private readonly authenticator: AccessAuthenticator,
    ) {}

    afterInit(): void {
        this.subscription = this.events.stream().subscribe((event) => {
            this.server.to(orderRoom(event.orderId)).emit('order.status', event)
        })
    }

    onModuleDestroy(): void {
        this.subscription?.unsubscribe()
    }

    @SubscribeMessage('join')
    async join(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { orderId?: unknown } | undefined,
    ): Promise<JoinAck> {
        const user = await this.authenticate(client.handshake.auth?.token)

        if (typeof user === 'string') {
            return { ok: false, error: user }
        }

        const orderId = toId(body?.orderId)
        const ownerId = orderId ? await this.orders.findOwnerId(orderId) : null

        if (!orderId || !ownerId) {
            return { ok: false, error: 'ORDER_NOT_FOUND' }
        }

        if (ownerId !== user.id) {
            return { ok: false, error: 'FORBIDDEN' }
        }

        const room = orderRoom(orderId)

        await client.join(room)

        return { ok: true, room }
    }

    private async authenticate(token: unknown): Promise<AuthenticatedUser | JoinFailure> {
        if (typeof token !== 'string' || token.length === 0) {
            return 'UNAUTHORIZED'
        }

        return this.authenticator.authenticate(token).catch((error: unknown) => {
            if (error instanceof AccessTokenRejectedError) {
                return 'UNAUTHORIZED' as const
            }

            if (error instanceof RevocationCheckUnavailableError) {
                return 'UNAVAILABLE' as const
            }

            throw error
        })
    }
}
