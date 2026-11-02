import type { Request } from 'express'
import type { UserRole } from '../entities/user.entity'

export type AuthenticatedUser = {
    id: string
    role: UserRole
    sessionId: string
    tokenId: string
    expiresAt: number
}

export type AuthenticatedRequest = Request & {
    user: AuthenticatedUser
}