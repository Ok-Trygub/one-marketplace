import { createPrivateKey, createPublicKey } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { z } from 'zod'

const isP256Key =
    (toKey: (pem: string) => KeyObject) =>
        (value: string): boolean => {
            try {
                const key = toKey(Buffer.from(value, 'base64').toString('utf8'))

                return key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
            } catch {
                return false
            }
        }

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535),

    DB_URL: z
        .url({
            protocol: /^postgres$/,
        })
        .optional(),

    DB_PASSWORD_FILE: z.string().min(1).default('secrets/db_password'),

    BROKER_URL: z.url({
        protocol: /^amqps?$/,
    }),

    REDIS_URL: z.url({
        protocol: /^rediss?$/,
    }),

    REDIS_QUEUE_URL: z.url({
        protocol: /^rediss?$/,
    }),

    JWT_PRIVATE_KEY: z.string().refine(isP256Key(createPrivateKey), {
        message: 'must be a base64-encoded PEM private key on the P-256 curve',
    }),

    JWT_PUBLIC_KEY: z.string().refine(isP256Key(createPublicKey), {
        message: 'must be a base64-encoded PEM public key on the P-256 curve',
    }),

    JWT_KID: z.string().min(1),

    REFRESH_TOKEN_PEPPER: z.string().min(32),

    LOG_LEVEL: z
        .enum(['debug', 'info', 'warn', 'error'])
        .default('info'),

    TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(5000),
})

export type Env = z.infer<typeof envSchema>

export function validate(raw: Record<string, unknown>): Env {
    const parsed = envSchema.safeParse(raw)

    if (!parsed.success) {
        throw new Error(
            `Invalid environment configuration:\n${parsed.error.issues
                .map(
                    (issue) =>
                        `${issue.path.join('.')}: ${issue.message}`,
                )
                .join('\n')}`,
        )
    }

    return parsed.data
}