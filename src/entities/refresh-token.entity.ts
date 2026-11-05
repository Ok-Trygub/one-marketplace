import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { User } from './user.entity'

@Entity({ name: 'refresh_tokens' })
@Index('refresh_tokens_token_hash_key', ['tokenHash'], { unique: true })
@Index('refresh_tokens_family_id_idx', ['familyId'])
@Index('refresh_tokens_expires_at_idx', ['expiresAt'])
@Index('refresh_tokens_revoked_at_idx', ['revokedAt'], { where: '"revoked_at" IS NOT NULL' })
export class RefreshToken {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Column({ type: 'bigint', name: 'user_id' })
    userId!: string

    @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'user_id' })
    user!: User

    @Column({ type: 'uuid', name: 'family_id' })
    familyId!: string

    @Column({ type: 'text', name: 'token_hash' })
    tokenHash!: string

    @Column({ type: 'timestamptz', name: 'expires_at' })
    expiresAt!: Date

    @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
    usedAt!: Date | null

    @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
    revokedAt!: Date | null

    @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
    createdAt!: Date
}