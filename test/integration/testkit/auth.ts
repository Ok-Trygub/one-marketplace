import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { TokenService } from '../../../src/auth/token.service'
import type { User } from '../../../src/entities/user.entity'

export const bearer = async (app: INestApplication, user: Pick<User, 'id' | 'role'>): Promise<string> => {
    const { accessToken } = await app.get(TokenService).signAccess({ id: user.id, role: user.role }, randomUUID())

    return `Bearer ${accessToken}`
}
