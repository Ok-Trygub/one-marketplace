import { Injectable } from '@nestjs/common'
import { AccessDenylist } from './access-denylist'
import type { AuthenticatedUser } from './authenticated-user'
import { TokenService } from './token.service'
import type { AccessClaims } from './token.service'

export class AccessTokenRejectedError extends Error {
    override readonly name = 'AccessTokenRejectedError'
}

export class RevocationCheckUnavailableError extends Error {
    override readonly name = 'RevocationCheckUnavailableError'

    constructor() {
        super('Token revocation status cannot be checked, retry later')
    }
}

@Injectable()
export class AccessAuthenticator {
    constructor(
        private readonly tokens: TokenService,
        private readonly denylist: AccessDenylist,
    ) {}

    async authenticate(token: string): Promise<AuthenticatedUser> {
        const claims = await this.verify(token)

        if (await this.isDenied(claims.jti, claims.sid)) {
            throw new AccessTokenRejectedError('Access token has been revoked')
        }

        return {
            id: claims.sub,
            role: claims.role,
            sessionId: claims.sid,
            tokenId: claims.jti,
            expiresAt: claims.exp,
        }
    }

    async isStillValid(user: AuthenticatedUser): Promise<boolean> {
        if (user.expiresAt <= Math.floor(Date.now() / 1000)) {
            return false
        }

        try {
            return !(await this.denylist.isDenied(user.tokenId, user.sessionId))
        } catch (error) {
            console.warn(
                `auth: denylist is unavailable, open stream closed: ${error instanceof Error ? error.message : error}`,
            )

            return false
        }
    }

    private async verify(token: string): Promise<AccessClaims> {
        try {
            return await this.tokens.verifyAccess(token)
        } catch {
            throw new AccessTokenRejectedError('Access token is invalid or expired')
        }
    }

    private async isDenied(tokenId: string, sessionId: string): Promise<boolean> {
        try {
            return await this.denylist.isDenied(tokenId, sessionId)
        } catch (error) {
            console.warn(
                `auth: denylist is unavailable, request refused: ${error instanceof Error ? error.message : error}`,
            )

            throw new RevocationCheckUnavailableError()
        }
    }
}
