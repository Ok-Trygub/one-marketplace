import { Module } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ChannelModel } from 'amqplib'
import { BROKER_CONNECTION, connectBroker } from './broker'
import { OrderPlacedPublisher } from './order-placed.publisher'
import type { Env } from '../config/env.schema'

class BrokerLifecycle implements OnModuleDestroy {
    constructor(private readonly connection: ChannelModel) {}

    onModuleDestroy(): Promise<void> {
        return this.connection.close()
    }
}

@Module({
    providers: [
        {
            provide: BROKER_CONNECTION,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) =>
                connectBroker(process.env.BROKER_URL ?? config.get('BROKER_URL', { infer: true })),
        },
        {
            provide: BrokerLifecycle,
            inject: [BROKER_CONNECTION],
            useFactory: (connection: ChannelModel) => new BrokerLifecycle(connection),
        },
        OrderPlacedPublisher,
    ],
    exports: [BROKER_CONNECTION, OrderPlacedPublisher],
})
export class MessagingModule {}
