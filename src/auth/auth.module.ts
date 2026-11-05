import { createPrivateKey } from 'node:crypto'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Env } from '../config/env.schema'
import { DatabaseModule } from '../database/database.module'
import { RedisModule } from '../redis/redis.module'
import { AccessAuthenticator } from './access-authenticator'
import { AccessDenylist } from './access-denylist'
import { AuthMaintenance } from './auth-maintenance'
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
import { JWT_VERIFICATION_KEYS, pemFromBase64, verificationKeysFromConfig } from './verification-keys'

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => ({
                privateKey: createPrivateKey(pemFromBase64(config.get('JWT_PRIVATE_KEY', { infer: true }))),
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
    providers: [
        {
            provide: JWT_VERIFICATION_KEYS,
            inject: [ConfigService],
            useFactory: verificationKeysFromConfig,
        },
        TokenService,
        AuthService,
        AccessDenylist,
        AuthMaintenance,
        AccessAuthenticator,
        AuthGuard,
        RolesGuard,
    ],
    exports: [TokenService, AuthService, AccessDenylist, AccessAuthenticator, AuthGuard, RolesGuard],
})
export class AuthModule {}