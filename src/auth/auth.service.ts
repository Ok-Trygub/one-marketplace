import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { RefreshToken } from '../entities/refresh-token.entity'
import { User } from '../entities/user.entity'
import type { UserRole } from '../entities/user.entity'
import { AccessDenylist } from './access-denylist'
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants'
import type { AuthenticatedUser } from './authenticated-user'
import { hashPassword, verifyPassword } from './password'
import { TokenService } from './token.service'

export class InvalidCredentialsError extends Error {
    override readonly name = 'InvalidCredentialsError'

    constructor() {
        super('Email or password is incorrect')
    }
}

export class InvalidRefreshTokenError extends Error {
    override readonly name = 'InvalidRefreshTokenError'

    constructor() {
        super('Refresh token is invalid, expired or revoked')
    }
}

export type TokenPair = {
    accessToken: string
    expiresIn: number
    refreshToken: string
}

type TokenOwner = {
    id: string
    role: UserRole
}

type RotationOutcome =
    | { kind: 'rotated'; owner: TokenOwner; familyId: string; refreshToken: string }
    | { kind: 'reused'; userId: string; familyId: string }
    | { kind: 'invalid' }

const refreshExpiresAt = (): Date => new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)

@Injectable()
export class AuthService {
    private readonly dummyHash = hashPassword(randomUUID())

    constructor(
        private readonly dataSource: DataSource,
        private readonly tokens: TokenService,
        private readonly denylist: AccessDenylist,
    ) {}

    async login(email: string, password: string): Promise<TokenPair> {
        const user = await this.dataSource.getRepository(User).findOneBy({ email: email.toLowerCase() })
        const valid = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash))

        if (!user || !user.passwordHash || !valid) {
            throw new InvalidCredentialsError()
        }

        const familyId = randomUUID()
        const { refreshToken, tokenHash } = this.tokens.issueRefresh()

        await this.dataSource.getRepository(RefreshToken).insert({
            userId: user.id,
            familyId,
            tokenHash,
            expiresAt: refreshExpiresAt(),
        })

        return this.pair({ id: user.id, role: user.role }, familyId, refreshToken)
    }

    async refresh(presented: string): Promise<TokenPair> {
        const tokenHash = this.tokens.hashRefresh(presented)

        const outcome = await this.dataSource.transaction(async (manager): Promise<RotationOutcome> => {
            const used = await manager
                .createQueryBuilder()
                .update(RefreshToken)
                .set({ usedAt: () => 'now()' })
                .where('token_hash = :tokenHash', { tokenHash })
                .andWhere('used_at IS NULL')
                .andWhere('revoked_at IS NULL')
                .andWhere('expires_at > now()')
                .andWhere(
                    'NOT EXISTS (SELECT 1 FROM refresh_tokens sibling WHERE sibling.family_id = refresh_tokens.family_id AND sibling.revoked_at IS NOT NULL)',
                )
                .returning(['userId', 'familyId'])
                .execute()

            const row = used.raw[0] as { user_id: string; family_id: string } | undefined

            if (row) {
                const owner = await manager.getRepository(User).findOneOrFail({
                    where: { id: row.user_id },
                    select: { id: true, role: true },
                })
                const next = this.tokens.issueRefresh()

                await manager.getRepository(RefreshToken).insert({
                    userId: owner.id,
                    familyId: row.family_id,
                    tokenHash: next.tokenHash,
                    expiresAt: refreshExpiresAt(),
                })

                return { kind: 'rotated', owner, familyId: row.family_id, refreshToken: next.refreshToken }
            }

            const known = await manager.getRepository(RefreshToken).findOneBy({ tokenHash })

            if (!known?.usedAt || known.revokedAt) {
                return { kind: 'invalid' }
            }

            await manager
                .createQueryBuilder()
                .update(RefreshToken)
                .set({ revokedAt: () => 'now()' })
                .where('family_id = :familyId', { familyId: known.familyId })
                .andWhere('revoked_at IS NULL')
                .execute()

            return { kind: 'reused', userId: known.userId, familyId: known.familyId }
        })

        if (outcome.kind === 'reused') {
            console.warn(
                `refresh token reuse detected: user=${outcome.userId} family=${outcome.familyId}, family revoked`,
            )

            await this.denylist.revokeSession(outcome.familyId).catch((error: unknown) => {
                console.warn(
                    `auth: access tokens of family ${outcome.familyId} stay valid until they expire, denylist write failed: ${error instanceof Error ? error.message : error}`,
                )
            })
        }

        if (outcome.kind !== 'rotated') {
            throw new InvalidRefreshTokenError()
        }

        return this.pair(outcome.owner, outcome.familyId, outcome.refreshToken)
    }

    async logout(user: AuthenticatedUser): Promise<void> {
        await this.dataSource
            .createQueryBuilder()
            .update(RefreshToken)
            .set({ revokedAt: () => 'now()' })
            .where('family_id = :familyId', { familyId: user.sessionId })
            .andWhere('revoked_at IS NULL')
            .execute()

        await this.denylist.logout(user.tokenId, user.expiresAt, user.sessionId)
    }

    private async pair(owner: TokenOwner, familyId: string, refreshToken: string): Promise<TokenPair> {
        const access = await this.tokens.signAccess(owner, familyId)

        return { ...access, refreshToken }
    }
}