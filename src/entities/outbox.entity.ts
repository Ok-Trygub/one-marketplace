import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'outbox' })
@Check('outbox_attempts_check', 'attempts >= 0')
@Index('outbox_unpublished_idx', ['createdAt'], { where: '"published_at" IS NULL' })
export class Outbox {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Column({ type: 'text', name: 'aggregate_type' })
    aggregateType!: string

    @Column({ type: 'text', name: 'aggregate_id' })
    aggregateId!: string

    @Column({ type: 'text' })
    type!: string

    @Column({ type: 'jsonb' })
    payload!: Record<string, unknown>

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
    publishedAt!: Date | null

    @Column({ type: 'integer', default: 0 })
    attempts!: number
}