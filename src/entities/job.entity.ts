import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm'

@Entity({ name: 'jobs' })
@Check('jobs_status_check', "status IN ('pending', 'done', 'failed')")
@Check('jobs_processed_check', 'processed >= 0')
@Check('jobs_attempts_check', 'attempts >= 0')
@Index('jobs_pending_queue_id_idx', ['queue', 'id'], { where: "status = 'pending'" })
export class Job {
    @PrimaryGeneratedColumn('identity', {
        type: 'bigint',
        generatedIdentity: 'ALWAYS',
    })
    id!: string

    @Column({ type: 'text', default: 'default' })
    queue!: string

    @Column({ type: 'text' })
    type!: string

    @Column({ type: 'jsonb' })
    payload!: Record<string, unknown>

    @Column({ type: 'text', default: 'pending' })
    status!: string

    @Column({ type: 'integer', default: 0 })
    processed!: number

    @Column({ type: 'integer', default: 0 })
    attempts!: number

    @Column({ type: 'text', name: 'last_error', nullable: true })
    lastError!: string | null

    @Column({ type: 'text', nullable: true })
    worker!: string | null

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
    processedAt!: Date | null
}
