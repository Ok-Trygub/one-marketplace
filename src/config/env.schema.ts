import { z } from 'zod'

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535),

    DB_URL: z.url({
        protocol: /^postgres$/,
    }),

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