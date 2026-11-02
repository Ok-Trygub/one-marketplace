import { createPrivateKey, createPublicKey } from 'node:crypto'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Env } from '../config/env.schema'
import { DatabaseModule } from '../database/database.module'
import { RedisModule } from '../redis/redis.module'
import { AccessAuthenticator } from './access-authenticator'
import { AccessDenylist } from './access-denylist'
import {
    ACCESS_TOKEN_TTL_SECONDS,
    JWT_ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
} from './auth.constants'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { RolesGuard } from './roles.guard'
import { TokenService } from './token.service'

const pem = (base64: string): string => Buffer.from(base64, 'base64').toString('utf8')

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => ({
                privateKey: createPrivateKey(pem(config.get('JWT_PRIVATE_KEY', { infer: true }))),
                publicKey: createPublicKey(pem(config.get('JWT_PUBLIC_KEY', { infer: true }))),
                signOptions: {
                    algorithm: JWT_ALGORITHM,
                    keyid: config.get('JWT_KID', { infer: true }),
                    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
                    issuer: JWT_ISSUER,
                    audience: JWT_AUDIENCE,
                },
                verifyOptions: {
                    algorithms: [JWT_ALGORITHM],
                    issuer: JWT_ISSUER,
                    audience: JWT_AUDIENCE,
                },
            }),
        }),
    ],
    providers: [TokenService, AuthService, AccessDenylist, AccessAuthenticator, AuthGuard, RolesGuard],
    exports: [TokenService, AuthService, AccessDenylist, AccessAuthenticator, AuthGuard, RolesGuard],
})
export class AuthModule {}