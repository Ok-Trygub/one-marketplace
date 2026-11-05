import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { UserRole } from '../entities/user.entity'
import type { AuthenticatedRequest } from './authenticated-user'
import { ROLES_KEY } from './roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ])

        if (!allowed?.length) {
            return true
        }

        const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>()

        if (!user) {
            throw new UnauthorizedException('Authorization header with a Bearer access token is required')
        }

        if (!allowed.includes(user.role)) {
            throw new ForbiddenException(`Role '${user.role}' is not allowed to perform this action`)
        }

        return true
    }
}
