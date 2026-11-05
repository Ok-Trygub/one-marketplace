import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Env } from '../config/env.schema'
import type { UserRole } from '../entities/user.entity'
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants'
import { JWT_VERIFICATION_KEYS } from './verification-keys'
import type { VerificationKeys } from './verification-keys'

export type AccessClaims = {
    sub: string
    role: UserRole
    sid: string
    jti: string
    iat: number
    exp: number
}

export type IssuedAccessToken = {
    accessToken: string
    expiresIn: number
}

export type IssuedRefreshToken = {
    refreshToken: string
    tokenHash: string
}

@Injectable()
export class TokenService {
    private readonly pepper: string

    constructor(
        private readonly jwt: JwtService,
        config: ConfigService<Env, true>,
        @Inject(JWT_VERIFICATION_KEYS) private readonly verificationKeys: VerificationKeys,
    ) {
        this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true })
    }

    async signAccess(user: { id: string; role: UserRole }, sessionId: string): Promise<IssuedAccessToken> {
        const accessToken = await this.jwt.signAsync(
            { role: user.role, sid: sessionId },
            { subject: user.id, jwtid: randomUUID() },
        )

        return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
    }

    async verifyAccess(token: string): Promise<AccessClaims> {
        const kid = this.jwt.decode<{ header?: { kid?: unknown } } | null>(token, { complete: true })?.header?.kid
        const publicKey = typeof kid === 'string' ? this.verificationKeys.get(kid) : undefined

        if (!publicKey) {
            throw new Error(`Access token is signed with an unknown key '${String(kid)}'`)
        }

        return this.jwt.verifyAsync<AccessClaims>(token, { publicKey })
    }

    issueRefresh(): IssuedRefreshToken {
        const refreshToken = randomBytes(32).toString('base64url')

        return { refreshToken, tokenHash: this.hashRefresh(refreshToken) }
    }

    hashRefresh(refreshToken: string): string {
        return createHmac('sha256', this.pepper).update(refreshToken).digest('hex')
    }
}