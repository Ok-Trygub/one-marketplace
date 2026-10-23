import { Module } from '@nestjs/common'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { MessagingModule } from './messaging/messaging.module'
import { RedisModule } from './redis/redis.module'
import { HealthController } from './controllers/health.controller'
import { ProductsController } from './controllers/products.controller'
import { OrdersController } from './controllers/orders.controller'
import { SessionsController } from './controllers/sessions.controller'
import { ProductsRepository } from './repositories/products.repository'
import { OrdersRepository } from './repositories/orders.repository'
import { UsersRepository } from './repositories/users.repository'
import { OrderEventsService } from './services/order-events.service'
import { OrderStatusService } from './services/order-status.service'
import { PlaceOrderService } from './services/place-order.service'
import { ProductCardService } from './services/product-card.service'
import { SessionService } from './services/session.service'
import { RateLimiterService } from './services/rate-limiter.service'
import { OrdersGateway } from './gateways/orders.gateway'

@Module({
    imports: [AppConfigModule, DatabaseModule, MessagingModule, RedisModule],
    controllers: [HealthController, ProductsController, OrdersController, SessionsController],
    providers: [
        ProductsRepository,
        OrdersRepository,
        UsersRepository,
        OrderEventsService,
        OrderStatusService,
        PlaceOrderService,
        ProductCardService,
        SessionService,
        RateLimiterService,
        OrdersGateway,
    ],
})
export class AppModule {}