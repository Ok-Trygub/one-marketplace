import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Post, UnauthorizedException } from '@nestjs/common'
import { SessionService } from '../services/session.service'
import type { Session } from '../services/session.service'
import { UsersRepository } from '../repositories/users.repository'

export type CreateSessionBody = {
    user_id: string
}

const isId = (value: string): boolean => /^\d+$/.test(value)

@Controller('sessions')
export class SessionsController {
    constructor(
        private readonly sessions: SessionService,
        private readonly users: UsersRepository,
    ) {}

    @Post()
    @HttpCode(201)
    async create(@Body() body: CreateSessionBody): Promise<Session> {
        if (!isId(body.user_id) || !(await this.users.exists(body.user_id))) {
            throw new NotFoundException(`User '${body.user_id}' was not found`)
        }

        return this.sessions.create(body.user_id)
    }

    @Get('me')
    async me(@Headers('x-session-token') token: string | undefined): Promise<Session> {
        const session = token ? await this.sessions.touch(token) : null

        if (!session) {
            throw new UnauthorizedException('X-Session-Token header with an active session is required')
        }

        return session
    }
}