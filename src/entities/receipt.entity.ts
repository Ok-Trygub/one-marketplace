import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { Order } from './order.entity'

@Entity({ name: 'receipts' })
@Check('receipts_total_check', 'total >= 0')
export class Receipt {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'text', name: 'event_id', unique: true })
    eventId!: string

    @Column({ type: 'bigint', name: 'order_id' })
    orderId!: string

    @ManyToOne(() => Order, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @JoinColumn({ name: 'order_id' })
    order!: Order

    @Column({ type: 'integer' })
    total!: number

    @CreateDateColumn({ type: 'timestamptz', name: 'issued_at' })
    issuedAt!: Date
}
