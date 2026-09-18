import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { User } from './user.entity'
import { OrderItem } from './order-item.entity'

@Entity({ name: 'orders' })
@Check('orders_status_check', "status IN ('pending', 'paid', 'cancelled')")
@Check('orders_total_check', 'total >= 0')
@Index('orders_user_id_created_at_idx', ['userId', 'createdAt'], { unique: true })
@Index('orders_cancelled_created_at_idx', ['createdAt'], {
    where: "status = 'cancelled'",
})
export class Order {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'bigint', name: 'user_id' })
    userId!: string

    @ManyToOne(() => User, (user) => user.orders, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @JoinColumn({ name: 'user_id' })
    user!: User

    @Column({ type: 'text' })
    status!: string

    @Column({ type: 'integer' })
    total!: number

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @OneToMany(() => OrderItem, (item) => item.order)
    items!: OrderItem[]
}