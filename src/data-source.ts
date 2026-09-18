import 'reflect-metadata'
import path from 'node:path'
import { DataSource } from 'typeorm'
import { User } from './entities/user.entity'
import { Product } from './entities/product.entity'
import { Order } from './entities/order.entity'
import { OrderItem } from './entities/order-item.entity'
import {Job} from "./entities/job.entity";

const env = (name: string): string => {
    const value = process.env[name]

    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: env('DB_HOST'),
    port: Number(env('DB_PORT')),
    username: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [path.join(__dirname, 'migrations', '*.js')],
    synchronize: false,
})