import { setTimeout as sleep } from 'node:timers/promises'

const RETRYABLE_CODES = new Set(['40001', '40P01'])

export type RetryInfo = {
    attempt: number
    code: string
    delayMs: number
}

export type RetryOptions = {
    label?: string
    maxAttempts?: number
    baseDelayMs?: number
    onRetry?: (info: RetryInfo) => void
}

const getErrorCode = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) {
        return undefined
    }

    const candidate = error as { code?: unknown; driverError?: { code?: unknown } }
    const code = candidate.code ?? candidate.driverError?.code

    return typeof code === 'string' ? code : undefined
}

export const withRetry = async <T>(
    operation: () => Promise<T>,
    options: RetryOptions = {},
): Promise<T> => {
    const { label = 'transaction', maxAttempts = 5, baseDelayMs = 20, onRetry } = options

    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation()
        } catch (error) {
            const code = getErrorCode(error)

            if (!code || !RETRYABLE_CODES.has(code) || attempt >= maxAttempts) {
                throw error
            }

            const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseDelayMs)

            console.warn(
                `${label}: caught ${code} on attempt ${attempt}, retrying whole transaction in ${delayMs} ms`,
            )
            onRetry?.({ attempt, code, delayMs })

            await sleep(delayMs)
        }
    }
}