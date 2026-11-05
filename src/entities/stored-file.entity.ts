import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { User } from './user.entity'

export const FILE_STATUSES = ['PENDING', 'COMPLETED'] as const

export type FileStatus = (typeof FILE_STATUSES)[number]

@Entity({ name: 'files' })
@Check('files_status_check', "status IN ('PENDING', 'COMPLETED')")
@Check('files_size_check', 'size > 0')
@Check('files_completed_at_check', "(status = 'COMPLETED') = (completed_at IS NOT NULL)")
@Index('files_key_key', ['key'], { unique: true })
@Index('files_owner_id_idx', ['ownerId'])
@Index('files_pending_created_at_idx', ['createdAt'], { where: `"status" = 'PENDING'` })
export class StoredFile {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Column({ type: 'text' })
    key!: string

    @Column({ type: 'bigint', name: 'owner_id' })
    ownerId!: string

    @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
    @JoinColumn({ name: 'owner_id' })
    owner!: User

    @Column({ type: 'text', default: 'PENDING' })
    status!: FileStatus

    @Column({ type: 'text', name: 'content_type' })
    contentType!: string

    @Column({ type: 'bigint' })
    size!: string

    @Column({ type: 'text', name: 'upload_id', nullable: true })
    uploadId!: string | null

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date

    @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
    completedAt!: Date | null
}