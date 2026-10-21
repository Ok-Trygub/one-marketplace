import { Module } from '@nestjs/common'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { MessagingModule } from './messaging/messaging.module'
import { HealthController } from './controllers/health.controller'
import { ProductsController } from './controllers/products.controller'
import { OrdersController } from './controllers/orders.controller'
import { ProductsRepository } from './repositories/products.repository'
import { OrdersRepository } from './repositories/orders.repository'
import { OrderEventsService } from './services/order-events.service'
import { OrderStatusService } from './services/order-status.service'
import { PlaceOrderService } from './services/place-order.service'
import { OrdersGateway } from './gateways/orders.gateway'

@Module({
    imports: [AppConfigModule, DatabaseModule, MessagingModule],
    controllers: [HealthController, ProductsController, OrdersController],
    providers: [
        ProductsRepository,
        OrdersRepository,
        OrderEventsService,
        OrderStatusService,
        PlaceOrderService,
        OrdersGateway,
    ],
})
export class AppModule {}
