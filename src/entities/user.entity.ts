import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { Order } from './order.entity'

@Entity({ name: 'users' })
@Check('users_phone_check', "phone ~ '^\\+380\\d{9}$'")
@Check('users_email_lower_check', 'email = lower(email)')
@Check('users_balance_check', 'balance >= 0')
export class User {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'text', unique: true })
    email!: string

    @Column({ type: 'text', unique: true })
    phone!: string

    @Column({ type: 'text' })
    name!: string

    @Column({ type: 'integer', default: 0 })
    balance!: number

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @OneToMany(() => Order, (order) => order.user)
    orders!: Order[]
}