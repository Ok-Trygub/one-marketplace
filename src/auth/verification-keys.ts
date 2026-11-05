import type { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.schema'

export const JWT_VERIFICATION_KEYS = 'JWT_VERIFICATION_KEYS'

export type VerificationKeys = ReadonlyMap<string, string>

export const pemFromBase64 = (base64: string): string => Buffer.from(base64, 'base64').toString('utf8')

export const verificationKeysFromConfig = (config: ConfigService<Env, true>): VerificationKeys => {
    const keys = new Map<string, string>([
        [config.get('JWT_KID', { infer: true }), pemFromBase64(config.get('JWT_PUBLIC_KEY', { infer: true }))],
    ])
    const previousKid = config.get('JWT_PREVIOUS_KID', { infer: true })
    const previousKey = config.get('JWT_PREVIOUS_PUBLIC_KEY', { infer: true })

    if (previousKid && previousKey) {
        keys.set(previousKid, pemFromBase64(previousKey))
    }

    return keys
}
