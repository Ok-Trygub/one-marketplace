import path from 'node:path'
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions'
import { User } from '../entities/user.entity'
import { Product } from '../entities/product.entity'
import { Order } from '../entities/order.entity'
import { OrderItem } from '../entities/order-item.entity'
import { Job } from '../entities/job.entity'

export type DatabaseConnection =
    | { url: string }
    | { host: string; port: number; username: string; password: string; database: string }

export const buildDataSourceOptions = (
    connection: DatabaseConnection,
): PostgresDataSourceOptions => ({
    type: 'postgres',
    ...connection,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [path.join(__dirname, '..', 'migrations', '*.js')],
    synchronize: false,
})
