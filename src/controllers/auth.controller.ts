import {
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    ServiceUnavailableException,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common'
import { AuthService, InvalidCredentialsError, InvalidRefreshTokenError } from '../auth/auth.service'
import type { TokenPair } from '../auth/auth.service'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import { CurrentUser } from '../auth/current-user.decorator'

export type LoginBody = {
    email: string
    password: string
}

export type RefreshBody = {
    refresh_token: string
}

export type MeResponse = {
    id: string
    role: string
}

export type TokenPairResponse = {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    refresh_token: string
}

const toResponse = (pair: TokenPair): TokenPairResponse => ({
    access_token: pair.accessToken,
    token_type: 'Bearer',
    expires_in: pair.expiresIn,
    refresh_token: pair.refreshToken,
})

const toUnauthorized = (error: unknown): never => {
    if (error instanceof InvalidCredentialsError || error instanceof InvalidRefreshTokenError) {
        throw new UnauthorizedException(error.message)
    }

    throw error
}

@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('login')
    @HttpCode(200)
    async login(@Body() body: LoginBody): Promise<TokenPairResponse> {
        return toResponse(await this.auth.login(body.email, body.password).catch(toUnauthorized))
    }

    @Post('refresh')
    @HttpCode(200)
    async refresh(@Body() body: RefreshBody): Promise<TokenPairResponse> {
        return toResponse(await this.auth.refresh(body.refresh_token).catch(toUnauthorized))
    }

    @Get('me')
    @UseGuards(AuthGuard)
    me(@CurrentUser() user: AuthenticatedUser): MeResponse {
        return { id: user.id, role: user.role }
    }

    @Post('logout')
    @HttpCode(204)
    @UseGuards(AuthGuard)
    async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
        await this.auth.logout(user).catch((error: unknown) => {
            console.warn(`auth: logout could not finish: ${error instanceof Error ? error.message : error}`)

            throw new ServiceUnavailableException('Logout could not be completed, retry the request')
        })
    }
}