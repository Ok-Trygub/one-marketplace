import {
    Check,
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { Order } from './order.entity'
import { Product } from './product.entity'

@Entity({ name: 'order_items' })
@Check('order_items_quantity_check', 'quantity > 0')
@Check('order_items_unit_price_check', 'unit_price > 0')
@Index('order_items_order_id_idx', ['orderId'])
@Index('order_items_product_id_idx', ['productId'])
export class OrderItem {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'bigint', name: 'order_id' })
    orderId!: string

    @ManyToOne(() => Order, (order) => order.items, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({ name: 'order_id' })
    order!: Order

    @Column({ type: 'bigint', name: 'product_id' })
    productId!: string

    @ManyToOne(() => Product, (product) => product.orderItems, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @JoinColumn({ name: 'product_id' })
    product!: Product

    @Column({ type: 'integer' })
    quantity!: number

    @Column({ type: 'integer', name: 'unit_price' })
    unitPrice!: number
}