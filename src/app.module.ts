import { Module } from '@nestjs/common'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { HealthController } from './controllers/health.controller'
import { ProductsController } from './controllers/products.controller'
import { OrdersController } from './controllers/orders.controller'
import { ProductsRepository } from './repositories/products.repository'
import { OrdersRepository } from './repositories/orders.repository'
import { OrderEventsService } from './services/order-events.service'
import { OrderStatusService } from './services/order-status.service'
import { OrdersGateway } from './gateways/orders.gateway'

@Module({
    imports: [AppConfigModule, DatabaseModule],
    controllers: [HealthController, ProductsController, OrdersController],
    providers: [
        ProductsRepository,
        OrdersRepository,
        OrderEventsService,
        OrderStatusService,
        OrdersGateway,
    ],
})
export class AppModule {}
