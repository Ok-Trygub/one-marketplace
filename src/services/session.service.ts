import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_STATE } from '../redis/redis'

export type Session = {
    token: string
    user_id: string
    created_at: string
}

export const SESSION_TTL_SECONDS = 1800

export const sessionKey = (token: string): string => `session:${token}`

@Injectable()
export class SessionService {
    constructor(@Inject(REDIS_STATE) private readonly redis: Redis) {}

    async create(userId: string): Promise<Session> {
        const session: Session = {
            token: randomUUID(),
            user_id: userId,
            created_at: new Date().toISOString(),
        }

        await this.redis.set(sessionKey(session.token), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)

        return session
    }

    async touch(token: string): Promise<Session | null> {
        const raw = await this.redis.getex(sessionKey(token), 'EX', SESSION_TTL_SECONDS)

        return raw ? (JSON.parse(raw) as Session) : null
    }
}