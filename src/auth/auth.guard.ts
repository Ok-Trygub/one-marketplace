import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { AccessAuthenticator, AccessTokenRejectedError, RevocationCheckUnavailableError } from './access-authenticator'
import type { AuthenticatedRequest } from './authenticated-user'

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authenticator: AccessAuthenticator) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
        const match = BEARER.exec(request.header('authorization') ?? '')

        if (!match) {
            throw new UnauthorizedException('Authorization header with a Bearer access token is required')
        }

        request.user = await this.authenticator.authenticate(match[1]).catch((error: unknown) => {
            if (error instanceof AccessTokenRejectedError) {
                throw new UnauthorizedException(error.message)
            }

            if (error instanceof RevocationCheckUnavailableError) {
                throw new ServiceUnavailableException(error.message)
            }

            throw error
        })

        return true
    }
}
