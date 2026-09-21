import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { OrderItem } from './order-item.entity'

@Entity({ name: 'products' })
@Check('products_price_check', 'price > 0')
@Check('products_stock_check', 'stock >= 0')
@Index('idx_products_search_vector', ['searchVector'], { type: 'gin' })
export class Product {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'text', unique: true })
    name!: string

    @Column({ type: 'text' })
    description!: string

    @Column({ type: 'integer' })
    price!: number

    @Column({ type: 'integer', default: 0 })
    stock!: number

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @Column({
        type: 'tsvector',
        name: 'search_vector',
        generatedType: 'STORED',
        asExpression: "to_tsvector('simple', name || ' ' || description)",
        insert: false,
        update: false,
        select: false,
    })
    searchVector!: string

    @OneToMany(() => OrderItem, (item) => item.product)
    orderItems!: OrderItem[]
}