import type { Env } from './config/env.schema'

const LOG_LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
} as const

type LogLevel = keyof typeof LOG_LEVEL_ORDER

export const createLogger = (level: Env['LOG_LEVEL']) => {
    const threshold = LOG_LEVEL_ORDER[level]

    const log =
        (
            levelName: LogLevel,
            write: (...args: unknown[]) => void
        ) =>
        (...args: unknown[]) => {
            if (LOG_LEVEL_ORDER[levelName] >= threshold) {
                write(...args)
            }
        }

    return {
        debug: log('debug', console.debug),
        info: log('info', console.info),
        warn: log('warn', console.warn),
        error: log('error', console.error),
    }
}
